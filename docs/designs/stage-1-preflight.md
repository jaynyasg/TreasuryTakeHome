# Stage 1 — Implementation Preflight

Source plan: `docs/designs/production-gap-closure.md` (LOCKED 2026-06-13). This doc
satisfies plan task **T0 (Implementation Preflight)** and specifies the worker artifact
contract **E1**. Constraints below are drawn verbatim from the plan's *Temporal
Decisions* and *Implementation Step Accuracy Audit* sections; where this doc adds a
concrete choice (provider, tool, pool size), it is a recommendation to be confirmed at
implementation time, not a re-decision of locked scope.

## 1. Purpose

This document records the provider constraints and the worker artifact contract that
must be settled before any feature lane (T1–T12) is built, per plan task T0. Without it,
the split-worker architecture would be implemented against unverified assumptions about
Vercel Queues (beta), Vercel Blob signed-access limits, Postgres pooling under
serverless load, and Auth.js role/session shape. Settling these now keeps the
deterministic `npm run verify` gate stable and prevents provider rework mid-build. It is
a decision/reference doc, not code.

## 2. Provider Preflight Notes

### Queue — Vercel Queues (beta)

- **Choice:** Vercel Queues first, wrapped behind a `QueueAdapter` interface so the
  provider is swappable without touching worker logic.
- **Why:** Aligns with the existing Vercel deployment; gives a managed durable queue with
  per-case retry/replay without hand-rolling infrastructure.
- **Key constraints:**
  - **Push vs poll mode.** The worker runs off-Vercel (dedicated container host), so it
    **must use POLL mode** — poll-mode consumers are the supported path for consumers
    outside Vercel. Push mode is only valid if the first worker host is itself a Vercel
    push consumer.
  - **Auth:** consumers authenticate with **OIDC tokens**; the adapter holds token
    acquisition/refresh, not the worker job code.
  - **Region routing:** queue region must be pinned and recorded; cross-region dequeue
    latency is part of the staging smoke measurement.
  - **At-least-once delivery.** Jobs **must be idempotent.** Every job carries an
    **idempotency key** (case id + processing-attempt scope); the worker claim is guarded
    by the case state machine so a duplicate delivery cannot produce a second result.
  - **Visibility / retry semantics:** visibility timeout, max-receive count, and backoff
    are adapter config, captured in adapter contract tests alongside dead-letter handoff.
  - **Beta-status risk.** Vercel Queues is beta; API surface and SLAs may change. Beta
    limits and the fallback must be documented before T3 starts (this doc).
- **Documented fallback:** a managed queue (e.g. a hosted SQS/CloudAMQP-style broker) or
  a **Postgres-backed outbox** (jobs table with `state` / `next_attempt_at`, polled by the
  worker), both implemented behind the same `QueueAdapter` interface. The outbox path
  reuses the shared Postgres already required by T2, so it is the lowest-new-dependency
  fallback. The adapter contract tests (enqueue/dequeue, missing-job, retry, visibility,
  malformed payload) must pass against both the Vercel Queues adapter and the fallback.

### Storage — Vercel Blob (first)

- **Choice:** Vercel Blob for raw uploads, warning evidence crops, and export artifacts,
  behind a `StorageAdapter` interface.
- **Why:** Fastest storage path aligned with the current Vercel deployment; keeps
  metadata portable for a later object-store migration.
- **Key constraints:**
  - All object metadata is persisted in **Postgres** (an object-manifest row per blob):
    `provider`, `container`/bucket, `objectKey`, `checksum`, `size`, `contentType`,
    `retention` state/expiry. The blob store is never the source of truth for existence —
    the manifest row is, and reconciliation detects drift.
  - **Private / signed-access plan limits.** Reviewer file access requires short-lived
    scoped signed URLs issued **only after** app-level authorization, with access logged.
    If the Blob plan's private/signed-URL capability cannot satisfy reviewer
    authorization scoping + audit logging, use the documented fallback.
- **Documented fallback — app-mediated download/proxy.** When short-lived signed URLs
  cannot meet the authorization + audit requirement, file bytes are streamed through an
  authenticated Next.js/worker route that performs the same central authorization check,
  emits the access audit event, then proxies the object. Signed URLs are never stored as
  durable evidence under either path.

### Database — managed Postgres (shared by Vercel + worker)

- **Choice:** one managed Postgres instance as the single relational source of truth,
  shared by Vercel API routes and the worker.
- **Recommended concrete picks (confirm at T2 start):**
  - **Provider:** **Neon** (or Vercel Postgres, which is Neon-backed) — serverless
    Postgres with a built-in pooled endpoint, native to the Vercel marketplace, and a
    direct endpoint available for migrations and the worker.
  - **Migration tool:** **node-pg-migrate** (or `drizzle-kit` if the data layer adopts
    Drizzle). Add-only/expand-contract migrations only, per the plan's rollout posture.
  - **Pooling:** connect Vercel serverless functions through the **pooled / pgbouncer-style
    endpoint** (transaction pooling). Serverless functions open many short-lived
    connections and **exhaust direct Postgres connections** at batch scale, so the pooled
    endpoint is mandatory for function clients. The worker uses a small fixed `pg` pool
    against the direct (or pooled) endpoint.
- **Connection budget (initial, tune after staging measurement):**

  | Parameter | Initial value | Rationale |
  |---|---|---|
  | Worker DB pool size | 10 connections | Bounded, fits a single worker container under the managed-Postgres connection ceiling. |
  | Max concurrent DB-using jobs | 8 | Leaves headroom in the worker pool for transaction overlap and reconciliation/retention tasks. |
  | Vercel function client | Pooled endpoint only | Direct connections from functions exhaust the DB under 300-case fan-out. |

- **Transaction boundaries:** use-case / service-command modules own transactions;
  aggregate repositories accept an explicit transaction context; the state change plus its
  append-only audit event commit in the **same unit of work**.
- **Staging connection-exhaustion check (run BEFORE enabling 300-case batches):** drive a
  300-case stubbed durable batch in staging while holding the worker pool at its configured
  size and the function client on the pooled endpoint; assert no `too many connections`
  / pool-timeout errors, capture peak active connections vs the provider ceiling, and
  record oldest-connection age. This is a T0/T11 gate item, not optional.

### Auth — Auth.js / NextAuth-style

- **Choice:** Auth.js / NextAuth-style application auth first.
- **Constraints / assumptions:**
  - **Users and roles in Postgres** (`reviewer`, `admin`), via a database session/adapter
    so the worker and API share identity state.
  - **Seeded reviewer/admin users** for demo and staging environments.
  - **Assigned-batch scoping:** reviewer access is scoped to assigned batches; admin access
    is broader but still logged. Authorization is central/aggregate-level, not per-route ad
    hoc.
  - **Disposition identity capture:** every disposition records actor, role, timestamp, and
    reason into the append-only audit trail.
  - **Adapter seam for later SSO.** Leave an explicit provider/adapter seam so enterprise /
    government SSO can be added later without reworking the role and authorization model.
    This is the only auth depth in Stage 1 — SSO itself is deferred per plan scope.

## 3. Worker Artifact Contract (E1)

The worker is a **first-class deployable**, not a script. It shares the worker-safe core
(`lib/contract.ts` barrel, `lib/engine/*`, state machines) and must contain **no Next.js
imports**.

| Aspect | Contract |
|---|---|
| Source directory | `worker/` at repo root (own `package.json` / build target; imports the shared core, never `app/`). |
| Local run command | `npm run dev --workspace worker` (or `cd worker && npm run dev`) — runs the poll loop against local/staging adapters. |
| Build command | `npm run build --workspace worker` → compiled `worker/dist/`. |
| Container / host deploy | `worker/Dockerfile` (node:lts-slim base, `npm ci`, build, `CMD node dist/index.js`). Portable to any container host (Railway/Fly/Render first per "fast prototype worker first"; Azure-portable later). |
| Health endpoint | `GET /healthz` → `200 {status,version,queueMode,dbOk,lastPollAt}` for host liveness/readiness probes and the ops-console worker heartbeat. |
| Heartbeat | Worker writes a heartbeat row/metric so the ops console can show liveness independent of `/healthz`. |

### Environment-variable contract

| Var | Purpose | Required? |
|---|---|---|
| `DATABASE_URL` | Postgres connection (worker uses direct/pooled endpoint). | Yes |
| `DATABASE_POOL_MAX` | Worker `pg` pool size (default 10). | No |
| `QUEUE_PROVIDER` | `vercel` \| `outbox` \| `managed` — selects the `QueueAdapter`. | Yes |
| `QUEUE_URL` / `QUEUE_NAME` | Queue endpoint/name for the active provider. | Yes (provider-dependent) |
| `VERCEL_OIDC_TOKEN` / OIDC client creds | Poll-mode consumer auth for Vercel Queues. | Yes when `QUEUE_PROVIDER=vercel` |
| `QUEUE_REGION` | Pinned queue region. | No |
| `STORAGE_PROVIDER` | `vercel-blob` \| fallback — selects the `StorageAdapter`. | Yes |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob access token. | Yes when `STORAGE_PROVIDER=vercel-blob` |
| `OPENAI_API_KEY` | GPT-4o extraction (model calls live in the worker now, not only API routes). | Yes |
| `MODEL_CONCURRENCY` | Per-stage model-call concurrency cap. | No |
| `BATCH_SPEND_CAP` | Daily/batch model-spend cap; refuses new work when exceeded. | No |
| `WORKER_SHARED_SECRET` | Service-to-service auth for internal mutations / signed job payloads. | Yes |
| `WORKER_CONCURRENCY` | Max concurrent DB-using jobs (default 8). | No |
| `PORT` | Health-server port (default 8080). | No |
| `LOG_LEVEL` | Structured-log verbosity. | No |

### Deployment steps

1. **Staging:** provision staging Postgres/Blob/queue/auth secrets; deploy worker
   **disabled** (poll loop idle / durable-batch flag off); run `/healthz` and the staging
   connection-exhaustion check; run the tiny durable-batch post-deploy smoke.
2. **Production:** deploy worker disabled, then enable durable batch behind the feature
   flag for test users, then broaden. Rollback = disable `durableBatch` flag + worker
   processing kill switch; in-flight jobs drain or move to dead-letter.

## 4. E2E Harness Decision (T0)

**Current reality:** the repo has `puppeteer-core` + Vitest and **no Playwright** and no
`playwright.config.ts`. `npm run verify` = `typecheck && lint && test && eval` and must
stay **deterministic and offline** (the only quality gate — there is no CI). The plan's
test sections reference Playwright for E2E; the Implementation Step Accuracy Audit flagged
this gap and moved E2E harness setup into T0 as an explicit prerequisite.

**Decision:** document the E2E smoke harness contract now and create a stub (this section +
`tests/e2e/README.md`), but **defer live browser wiring and the Playwright dependency to
the observability/rollout stage (Stage 9 / T10–T11)**. Reasoning:

- Adding Playwright + browser downloads now would either pull a heavy, non-deterministic
  dependency into the `verify` gate or sit unused while feature lanes churn the UI it would
  target. There is no UI for these flows to drive yet.
- The E2E suite only becomes meaningful once the reviewer/admin UI (T7) and admin ops (T8)
  exist; wiring it earlier means rewriting selectors repeatedly.
- Stage 9 already owns post-deploy smoke and staging parity, the natural home for live
  browser E2E. Playwright is added there as a **separate script**, never folded into the
  default `verify` gate, preserving the deterministic offline guarantee.

This is a documented trade-off/limitation per TakeHome.docx's guidance to "document any
trade-offs or limitations."

**Required E2E smoke set** (from the plan; covered when the suite is wired in Stage 9):

1. Reviewer login → Work Queue.
2. Resumable intake (partial upload recovery / manifest pairing).
3. 300-case **stubbed** durable processing through to triage ordering.
4. Reviewer disposition + export download.
5. Admin dead-letter replay + operations health.

## 5. Exit Criteria

Mirrors plan T0's *Verify* line: "E2E smoke harness can run locally; provider notes
document Vercel Queues beta/poll-mode/OIDC/region constraints, Vercel Blob private/signed-
access fallback, Postgres pooling/provider choice, and Auth.js adapter/session
assumptions."

| Item | Status |
|---|---|
| Vercel Queues beta / poll-mode / OIDC / region constraints documented | Satisfied (§2 Queue) |
| Vercel Queues fallback provider named behind the adapter | Satisfied (§2 Queue) |
| Vercel Blob private/signed-access fallback documented | Satisfied (§2 Storage) |
| Postgres provider + migration tool + pooling choice documented | Satisfied (§2 Database) |
| Worker pool size / max concurrent DB jobs / transaction boundaries stated | Satisfied (§2 Database, §3) |
| Staging connection-exhaustion check defined | Satisfied (§2 Database) — execution deferred to staging (T11) |
| Auth.js adapter/session/role assumptions documented | Satisfied (§2 Auth) |
| Worker artifact contract (E1) specified | Satisfied (§3) |
| E2E smoke harness contract + stub created | Satisfied (§4, `tests/e2e/README.md`) |
| E2E smoke **runs locally** (live browser wiring) | **Deferred to Stage 9 / T10–T11** (§4 rationale); stub only in Stage 1 |
| Playwright dependency added to `package.json` | **Deferred to Stage 9** — intentionally not added to keep `verify` deterministic |
