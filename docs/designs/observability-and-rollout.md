# Observability & Rollout — Durable Batch Operations Runbook

Stage 9 / tasks T10 (Observability) + T11 (Deployment). Operational companion to
`docs/designs/production-gap-closure.md` ("Traceability", "Product health metrics",
"Runbooks and alerts", "Rollout sequence", "Environment parity", "Rollback Flow",
"Deployment Sequence", "Operational brakes") and `docs/designs/stage-1-preflight.md`
(§2 provider choices, §3 worker artifact, §4 E2E harness).

This document is the on-call surface: what IDs flow where, which metrics to watch, the
alert thresholds and the runbook for each, how to roll out behind the `DURABLE_BATCH`
flag, and how to roll back safely. It is concrete on purpose — an on-call engineer should
be able to act from it without reading source.

---

## 1. Trace-ID Propagation Map

Every durable operation carries a small set of correlated IDs so a single case can be
followed across web -> queue -> worker -> db -> storage -> model -> exports. IDs are
**app-minted `text`** (no `gen_random_uuid()` — see `0001_init.sql` rationale) precisely so
they can be propagated through systems that are not the database.

| ID | Minted by | Flows through | Persisted on | Purpose |
|---|---|---|---|---|
| `traceId` (request trace) | Vercel API route (per request) | queue payload -> worker -> attempts -> audit events -> export audit | `processing_attempts.trace_id`, `audit_events.trace_id` | End-to-end correlation of one logical action |
| `intakeSessionId` | Intake API (`createIntakeSession`) | `startBatch` -> batch row | `intake_sessions.id`, `batches.intake_session_id`, audit `afterSummary` | Tie a batch back to the upload session + idempotency key |
| `batchId` | `startBatch` | cases, jobs (implicitly via case), exports, retention | `batches.id`, `cases.batch_id`, `exports.batch_id` | Batch-scoped triage, export, retention |
| `caseId` | `startBatch` (per complete pair) | queue payload (`{caseId}`), worker, storage keys | `cases.id`, `queue_jobs.payload`, `extracted_fields.case_id`, `verdicts.case_id` | The unit of durable work; queue `idempotencyKey = caseId` |
| `jobId` | `startBatch` / `replayDeadLetter` (`randomUUID`) | queue claim -> worker | `queue_jobs.id`, dead-letter audit `beforeSummary.jobId` | Queue-level identity; ack/retry/deadLetter target |
| `attemptId` + `attempt_no` | worker (`startAttempt`) | finalizeAttempt, audit | `processing_attempts.id` / `.attempt_no` | Append-only per-attempt history (never overwritten) |
| `objectKey` | intake upload / worker / export | storage adapter + manifest row | `case_files.object_key`, `warning_evidence.crop_object_key`, `exports.object_key` | Object-manifest source of truth (Postgres, not the blob store) |
| `exportId` | `generateExport` | storage key `exports/{batchId}/{exportId}.csv` | `exports.id` | Point-in-time snapshot identity |

Propagation rules (enforced in code today):

- `startBatch` stamps `traceId` into each enqueued `CaseJobPayload` and the intake audit
  event. The worker re-reads it from the payload (`CaseJobPayload.traceId`) and threads it
  into every `startAttempt` / `finalizeAttempt` / `appendAuditEvent`.
- Storage object keys are **derived from `caseId`** (`labels/{caseId}/...`,
  `evidence/{caseId}/warning-crop`, `exports/{batchId}/{exportId}.csv`) so a blob can be
  traced to its case without a lookup table.
- `queue_jobs.idempotencyKey = caseId` for the first run and
  `${caseId}:replay:${attemptCount}` for a replay, so a replay is a distinct queue entry
  while still tracing to the same case.

Logging convention: every worker log line SHOULD include `caseId`, `jobId`, `attemptNo`,
and `traceId` as structured fields so a log search on any one ID returns the full timeline.

---

## 2. Product Health Metrics Catalog

These are the metrics the Operations Console surfaces (plan "Product health metrics"). Each
is cheap to compute from existing tables — no new instrumentation store is required for the
prototype.

| Metric | Source | Healthy range (prototype) |
|---|---|---|
| Queue depth (ready) | `QueueAdapter.stats().ready` / `queue_jobs` state=ready | tracks batch size; drains over time |
| In-flight count | `stats().inflight` | <= worker concurrency budget |
| Dead-letter count | `stats().deadLetter` / `cases` in `dead_letter`+`failed` | 0 in steady state |
| Oldest job age | `min(queue_jobs.created_at)` where state in (ready,inflight) | < first-result SLO (60s) |
| Retry rate | `processing_attempts` state=failed with a following attempt | low, bounded by `maxAttempts` |
| Stuck batch count | batches in `processing` with no case progress in N min | 0 |
| Warning needs-review count | `cases.status = needs_review` / `warning_evidence` | reviewer-drainable |
| Export failures | `exports.status = failed` | 0 |
| Retention overdue count | `retention_state` where `purge_eligible_at < now()` and `purged_at is null` | 0 (within grace) |
| Worker heartbeat age | `HealthState.markPoll` timestamp (worker `/healthz`) | < 3x poll interval |
| Estimated model spend | per-call cost x extraction count (budget caps, E11) | < daily/batch cap |
| Storage reconciliation drift | manifest rows vs `storage.list(prefix)` | 0 missing / 0 orphaned |

SLO targets (from the plan "Latency targets", prototype/staging stub-or-live-limited mode):
single-case verify <= 5s p50; 300-case preflight <= 10s; first durable result <= 60s;
50-case batch <= 10 min; 300-case batch <= 45 min.

---

## 3. Alert Thresholds + Response Runbooks

Each alert names a **threshold**, the **likely cause**, and the **response runbook** keyed
to the kill switches and admin controls that already exist (`replayDeadLetter`,
`retentionPurge`, the `DURABLE_BATCH` flag, per-stage kill switches).

### 3.1 Stuck jobs

- **Threshold:** any job `inflight` with `oldest job age > 5 min` (well past the 60s
  first-result SLO and the 30s visibility window), OR a batch in `processing` with no case
  state change for 10 min.
- **Likely cause:** worker crashed mid-claim (visibility window will redeliver), DB
  contention, or a poison case that throws before finalizing.
- **Runbook:** (1) check worker heartbeat (§3.3). (2) Confirm the visibility window is
  redelivering — `stats().inflight` should fall as jobs reappear `ready`. (3) If a single
  `caseId` is looping, inspect `processing_attempts` for its error_class; if poison, let it
  reach `maxAttempts` -> dead-letter, then repair + `replayDeadLetter`. (4) If many jobs are
  stuck, flip the **worker-processing kill switch**, drain, redeploy the worker, re-enable.

### 3.2 Dead-letter spike

- **Threshold:** `deadLetter` count increases by > 5 in 10 min, or > 2% of a batch.
- **Likely cause:** a systemic upstream failure (model outage, bad prompt deploy, malformed
  application data) — not one bad case.
- **Runbook:** (1) Sample 3 dead-lettered cases' `processing_attempts.error_class`. (2) If
  `timeout`/`empty` dominate -> model/provider issue (§3.4); if `malformed` dominates ->
  suspect a prompt/schema regression, roll back the worker image. (3) Do NOT mass-replay
  until the root cause is fixed — replay is append-only and guarded; replaying into a broken
  upstream just re-dead-letters. (4) After fix, `replayDeadLetter` each affected case (admin,
  reason note required, rate-limited).

### 3.3 Worker heartbeat loss

- **Threshold:** worker `/healthz` heartbeat age > 3x poll interval (no `markPoll`).
- **Likely cause:** worker container died, lost DB/queue connectivity, or OOM.
- **Runbook:** (1) Check host/container status and logs for the last `markError`. (2) The
  queue is durable — unacked in-flight jobs redeliver after the visibility window, so no work
  is lost. (3) Restart/redeploy the worker. (4) If connectivity to Postgres is the cause,
  check the connection budget (worker pool size vs Postgres max connections, preflight §2/§3)
  — a connection-exhaustion event looks like heartbeat loss.

### 3.4 Model / rate-limit spikes

- **Threshold:** extraction `error_class` in (`timeout`,`empty`) > 10% of attempts in 10 min,
  OR model spend approaching the daily/batch cap (E11).
- **Likely cause:** OpenAI 429/5xx, latency degradation, or budget exhaustion.
- **Runbook:** (1) Confirm with provider status. (2) `timeout` is retryable — bounded backoff
  (1s,2s,3s) absorbs transient spikes; watch that retries succeed rather than exhausting.
  (3) If sustained, flip the **model-calls kill switch** to pause extraction (jobs park
  `ready`, nothing is lost) until the provider recovers. (4) If spend-cap driven, raise the
  cap deliberately or hold the batch — never silently drop cases.

### 3.5 Export failures

- **Threshold:** any `exports.status = failed`, or an export `generating` for > 5 min.
- **Likely cause:** storage write failure, or a batch mutating heavily during snapshot.
- **Runbook:** (1) Exports are point-in-time and **idempotent to re-run** (a new export is a
  new snapshot) — simplest fix is request a fresh export. (2) The artifact is written BEFORE
  the terminal `complete`/`partial` status, so a `complete` export always has a retrievable
  blob; a stuck `generating` row means the blob write failed — check storage health. (3) If
  storage is down, flip the **exports kill switch**; queued exports wait.

### 3.6 Retention overdue

- **Threshold:** `retention_state.purge_eligible_at < now() - grace` with `purged_at is null`.
- **Likely cause:** the purge job is paused (kill switch) or failing.
- **Runbook:** (1) Purge is **two-phase**: first mark+preview counts, then delete leaving
  tombstones. Check whether the mark phase ran but the delete phase is paused. (2) Review the
  purge **preview counts** before approving (never bulk-delete blind). (3) If a protected
  archive exception is blocking, confirm the admin policy, then approve the remainder. (4)
  Re-run the delete phase; verify tombstones (`retention_state.tombstone`) are written for
  the deletion audit.

### 3.7 Storage reconciliation drift

- **Threshold:** manifest rows without a backing object (missing), or stored objects with no
  manifest row (orphaned), > 0.
- **Likely cause:** a blob write that succeeded while the DB write failed (or vice versa) —
  the classic split between `case_files`/`exports`/`warning_evidence` rows and the blob store.
- **Runbook:** (1) The **object manifest in Postgres is the source of truth** (plan "Storage
  consistency"). (2) **Missing object** (row, no blob): the case file is unusable -> surface
  a repair/re-upload action; the case routes to `needs_better_image`/`failed` rather than a
  misleading score. (3) **Orphaned blob** (blob, no row): safe to delete after a grace window
  — it is unreferenced. (4) Run reconciliation from the Storage tab; it lists both classes
  with repair/delete actions.

---

## 4. Environment Parity

Preview/staging must exercise the **real integrations at low limits** so the durable path is
proven before production (plan "Environment parity"; preflight §2).

| Concern | Preview / Staging | Production |
|---|---|---|
| Worker | Real containerized worker, poll mode, 1 instance | Real worker, scaled to concurrency budget |
| Database | Staging managed Postgres, small pool (run the connection-exhaustion check here) | Production Postgres, pooled per preflight §3 |
| Storage | Real Vercel Blob (separate store/prefix), short-lived signed URLs or proxy fallback | Production Blob |
| Queue | Real queue (Vercel Queues beta poll mode) or the Postgres-outbox fallback | Same adapter; provider chosen per preflight §2 |
| Auth | Auth.js with **seeded reviewer/admin users** (`scripts/seed.ts`) | Real users; SSO via the deferred adapter seam |
| Model | Live model under a **low daily/batch spend cap + low concurrency**, or stub mode | Live model, full caps |
| Data | Smoke fixtures (a tiny durable batch) | Real submissions |

Parity guarantee: the same `WorkerDeps` composition root (`buildProductionDeps`) builds both
environments — only env vars (`DATABASE_URL`, `QUEUE_PROVIDER`, blob token, `OPENAI_API_KEY`,
`WORKER_MAX_ATTEMPTS`, spend/concurrency caps, `DURABLE_BATCH`) differ. Offline tests use the
fakes (`createMemoryQueue`/`createFakeStorage`/`createStubModel`) that satisfy the same
adapter contracts.

---

## 5. Rollout Sequence (Expand-Contract)

The schema is **additive** (proven by `tests/db/migrationRollback.test.ts`): it ships first
and sits dormant behind `DURABLE_BATCH` until the flag turns on the code that uses it. This is
the plan's "Deployment Sequence":

1. **Apply schema/config with the flag OFF.** Migrations `0001 -> 0004` are add-only; an old
   binary keeps running against the new database (flag-off = the durable tables exist but are
   empty and unused).
2. **Provision staging secrets** (DB, Blob, queue, auth, worker, model, signing).
3. **Deploy the worker DISABLED** (worker-processing kill switch on). It can connect and report
   health but claims nothing.
4. **Deploy Vercel API/UI GATED** behind `DURABLE_BATCH` — the existing single/small-upload
   path stays the default.
5. **Run the staging smoke** (§7) against the tiny durable batch.
6. **Enable `DURABLE_BATCH` for test users** (seeded reviewer/admin) and enable worker
   processing.
7. **Run the production smoke** (§7) once promoted.
8. **Gradually widen** reviewer/admin access.

At every step the previous capability remains available; nothing is removed (contract phase is
deferred until the durable path is fully trusted).

---

## 6. Rollback Flow

Mirrors the plan "Rollback Flow". Order matters — stop new work first, drain safe work, then
recover:

1. **Disable `DURABLE_BATCH`.** New durable intake stops immediately; the single/small-upload
   path remains available, so reviewers are never fully blocked.
2. **Engage kill switches** as needed: durable-batch intake, worker processing, model calls,
   replay, exports, purge. Each pauses its stage without data loss — jobs park, blobs are
   untouched, rows are not deleted.
3. **Drain.** Let in-flight jobs finish or lapse; the visibility window redelivers anything
   unacked. Poison jobs reach `maxAttempts` and dead-letter (visible, not lost).
4. **Hold the additive schema in place.** Because every migration is add-only, there is NO
   down-migration to run — flag-off is the rollback. An old code deploy is safe against the
   new schema.
5. **Repair + replay** from the Ops Console after the fix: `replayDeadLetter` appends new
   attempts (never overwrites prior evidence) and re-enqueues with a fresh idempotency key.
6. **Re-enable** the flag/kill switches and re-run the post-deploy smoke.

Reversibility note (plan §10, score 4/5): the only thing flag-off cannot undo is rows already
written by durable processing — but those are visible, exportable, and never corrupt the
single-case path, so they are safe to leave in place.

---

## 7. Post-Deploy Smoke

A **tiny durable batch** is run after every deploy to prove the whole line connects (plan
"Post-deploy smoke"). The **offline form is automated and deterministic** in
`tests/smoke/durablePath.test.ts` (PGlite + memory queue + fake storage + stub model) and runs
in the gate; the **live form** repeats the same sequence against staging/production with real
integrations at low limits.

Smoke sequence (offline = green today; live = staging/prod):

1. **Intake -> `startBatch`:** one complete application+label pair becomes a batch + a `queued`
   case + an enqueued job.
2. **Worker -> `runOnce`:** claim, extract (stub/live model), deterministically score, persist
   the verdict, transition the case to a scored state; the job acks.
3. **Triage -> `recordDisposition`:** a reviewer approves; disposition + case transition +
   audit event commit atomically.
4. **Export -> `generateExport`:** a point-in-time CSV artifact covering the case is written to
   storage and recorded `complete`.
5. **Replay -> `replayDeadLetter`:** a poison ('timeout') case retries to its budget,
   dead-letters, and an admin replay makes it processable again (append-only — the dead-letter
   attempt is preserved), then re-processes to a scored verdict.
6. **Ops health:** queue depth, dead-letter count, and worker heartbeat are readable.

The **live browser E2E** (reviewer login/work-queue, resumable intake, 300-case stubbed
processing, disposition+export download, admin replay+ops health) stays a **separate Playwright
script**, deferred per `stage-1-preflight.md` §4 so it never enters the deterministic offline
`verify` gate.

---

## 8. Secret Rotation List

Document and schedule rotation for every secret on the durable path (plan "Operational
brakes"). Rotate via the provider, update the env in Vercel + the worker host, redeploy.

| Secret | Used by | Rotation notes |
|---|---|---|
| `AUTH_SECRET` (Auth.js) | Vercel API (JWT session signing) | Rotating invalidates active sessions — schedule off-peak; JWT strategy means no DB session cleanup |
| Worker service token | Vercel <-> worker service-to-service auth | Rotate both sides together; scoped, least-privilege |
| Queue provider token (OIDC) | Queue adapter (poll-mode claim) | Per preflight §2; short-lived OIDC tokens preferred |
| Vercel Blob token | Storage adapter | Scope to the durable-batch store/prefix |
| `DATABASE_URL` credentials | Vercel functions + worker pool | Use scoped DB roles where practical; coordinate pool restarts |
| `OPENAI_API_KEY` | Model adapter (worker) | Rotate on suspected leak; watch spend caps during rotation |
| Signed-URL signing key | File-access signed URLs | Short-lived URLs only; never persist a signed URL as durable evidence |

Rotation discipline: rotate one secret at a time, verify the post-deploy smoke (§7) stays
green after each, and record the rotation in the audit log.
