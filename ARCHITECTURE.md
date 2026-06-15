# ARCHITECTURE.md — TTB Label Verify (as built & deployed)

This is the consolidated architecture of the **actually built** system, not the plan's
aspiration. It reflects the deployed reality: the graded surface is the always-on stateless
**core**; a production-shaped **durable layer** is additive behind the `DURABLE_BATCH` flag and
is **off in production**.

- Live: <https://treasury-takehome-tau.vercel.app> (Vercel; GitHub push-to-`main` auto-deploys).
- Planning provenance: [`docs/designs/*`](docs/designs/) (see §8). Product brief: [`PRD.md`](PRD.md).
- Operational design system (reviewer/admin UI): [`DESIGN.md`](DESIGN.md).

---

## 1. Two-tier design (the load-bearing boundary)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  TIER A — ALWAYS-ON CORE  (the graded take-home; R1–R11)                        │
│  Stateless. No DB, no auth, no worker, no Blob. Needs ONLY OPENAI_API_KEY.      │
│                                                                                │
│   /  (Verify + Generate)   →  /api/verify, /api/extract-application, /api/cola  │
│   GPT-4o vision  →  zod contract  →  pure engine  →  match report (~5s)         │
│   Batch fans out CLIENT-SIDE (concurrency 4). Nothing persists server-side.     │
└──────────────────────────────────────────────────────────────────────────────┘
            ▲  shares the SAME oracle (lib/contract + lib/engine), never re-implemented
            │
┌───────────┴──────────────────────────────────────────────────────────────────┐
│  TIER B — DURABLE PRODUCTION LAYER  (additive, behind DURABLE_BATCH=1)          │
│  Production-shaped, flag-gated, NOT part of the graded default.                 │
│  Persists to Postgres + Blob; processes batches via an OFF-Vercel worker.       │
│                                                                                │
│   (reviewer)/* UI  →  intake/upload  →  startBatch  →  Postgres + queue         │
│        →  worker claims  →  extract+score (same engine)  →  verdict/evidence    │
│        →  triage queue  →  reviewer disposition  →  export / retention          │
└────────────────────────────────────────────────────────────────────────────────┘
```

**The boundary rule:** Tier B never regresses Tier A. With `DURABLE_BATCH` unset (the
production posture), `middleware.ts` only matches `/reviewer` and `/admin`, and the
`authorized` callback returns `true` for everything — so the public core (`/`, `/api/verify`,
`/api/extract-application`, the generator) is never intercepted and the durable tables sit
dormant. Both tiers import the **same** `lib/contract.ts` + `lib/engine/*` oracle, so scoring
is defined once and a verdict means the same thing whether it came from `/api/verify` or the
worker.

| | Tier A (core) | Tier B (durable) |
|---|---|---|
| Required env | `OPENAI_API_KEY` | `+ DATABASE_URL`, `AUTH_SECRET`, `STORAGE_PROVIDER=vercel-blob` + `BLOB_READ_WRITE_TOKEN`, `DURABLE_BATCH=1`, a worker host |
| State | none (per session) | Postgres aggregates + audit events; Blob objects |
| Batch | client-side fan-out (concurrency 4) | server-side queue + off-Vercel poll worker |
| Auth | none | Auth.js Credentials (reviewer/admin) |
| Graded? | **yes** | no (flag-off in prod) |

---

## 2. Module map

| Path | Responsibility |
|---|---|
| `lib/contract.ts` | The single typed zod contract at **every** seam: LLM output, API payloads, worker jobs, client. Parse-or-fallback — external/LLM shapes are validated at the boundary, never trusted. |
| `lib/engine/` | Pure, I/O-free, fully unit-tested matching oracle: `warning.ts` (word-for-word GOVERNMENT WARNING, all-caps lead-in), `normalize.ts` (judgment-tier equivalences + explanations), `score.ts` (per-field verdicts → match %), `generator.ts` (seeded mock generator, ground truth by construction). Never imports the OpenAI SDK. |
| `lib/extract.ts` / `lib/applicationExtract.ts` | The core LLM seams: extract an `ExtractedLabel` from a label image / a `ColaApplication` from an uploaded application PDF (GPT-4o, temperature 0, schema-constrained). Used only by API routes. |
| `lib/core/` | **Worker-safe boundary**: re-exports `lib/contract` + `lib/engine` plus the typed `state/` machines (`batch.ts`, `case.ts`, `transition.ts`). Anything the worker shares with the web lives behind this — no `next`/`react` imports cross it. |
| `lib/db/` | Driver-agnostic persistence seam. `client.ts` = the `Queryable`/`DbClient` interface; `pglite.ts` (tests, in-process) and `pg.ts` (`pg` Pool, prod) both satisfy it. `migrate.ts` + `migrations/0001..0004`. `repositories/*` take a `Queryable` and never open transactions; `services/*` are service-commands that own `transaction()` so a state change + its audit event commit together. `seed.ts` seeds demo users. |
| `lib/adapters/` | Provider seams kept at the edge behind shared `contractTest.ts` behavior contracts: `storage/` (`vercelBlob` ↔ `fake`), `queue/` (`postgresOutbox` ↔ `memory`), `model/` (`openai` ↔ `stub`). Each is a one-file swap; the fake/stub carry the contract offline. |
| `worker/` | The off-Vercel poll-mode worker. `index.ts` (entry + `GET /healthz`), `loop.ts` (`runWorkerLoop`/`runOnce`), `processCase.ts` (claim → extract → score → verdict/evidence → finalize, every step a guarded transition + audited attempt), `application.ts` (reconstruct/extract the `ColaApplication`), `deps.ts`, `health.ts`, `Dockerfile`. Worker-safe: shared core + adapters only. |
| `lib/auth/` + `auth.ts` + `auth.config.ts` + `middleware.ts` | Credentials auth. `lib/auth/password.ts` (scrypt) + `authorize.ts`; `auth.ts` wires the DB-backed Credentials provider (Node runtime); `auth.config.ts` is the edge-safe slice (no `pg`/`crypto`); `middleware.ts` gates `/reviewer` + `/admin` only, and only when `DURABLE_BATCH=1`. |
| `lib/flags.ts` | One typed source of truth for the `DURABLE_BATCH` rollout flag + the runtime kill switches (worker processing, model calls, replay, exports, purge). Pure, env-injectable. |
| `lib/observability/` | `trace.ts` (correlation-id vocabulary threaded batch→case→job→attempt→export through logs/payloads/rows) + `log.ts`. |
| `lib/config/limits.ts` | Typed SLO / concurrency / spend budgets (per-stage concurrency, spend caps, latency targets incl. ≤5s p50 single-case), env-injectable. |
| `app/` | Next.js App Router. Public core: `page.tsx`, `/api/verify`, `/api/extract-application`, `/api/cola`. Durable area: `(reviewer)/` (reviewer queue/case/intake/exports + admin ops console), `/api/intake/*`, `/api/files/[id]`, `/api/auth/*`, `/login`. |
| `components/` | `house/` = shared house-style primitives; `intake/ queue/ case/ admin/ app-shell/` = the reviewer/admin workbench; root `VerifyView`/`GeneratorView`/`ResultPanel`/`ApplicationForm` = the public core. |

---

## 3. Data flow A — synchronous core verify path

```
label file(s) ─┐
               ▼
         POST /api/verify ──► lib/extract.ts (GPT-4o vision, temp 0, JSON-schema)
application ──►│                        │
fields         │                        ▼
(form OR       │                lib/contract.ts  (zod gate: refusal/truncation/drift → clean error)
 /api/extract- │                        │
 application)  │                        ▼
               └──────────────► lib/engine/score.ts  (warning + normalize + per-field verdicts)
                                        │
                                        ▼
                                  MatchReport  →  ResultPanel (overall % + per-field reason)
```

One outbound call (OpenAI), pure scoring after. ~4.5s measured, ≤5s p50 codified in
`lib/config/limits.ts`. The generator path renders seeded mock application+label pairs to PDF
and runs them through this **same** pipeline. Batch fan-out is client-side in `GeneratorView`.

---

## 4. Data flow B — durable batch path (`DURABLE_BATCH=1`)

```
 reviewer ──► (reviewer)/reviewer/intake
                 │  POST /api/intake            create session
                 │  POST /api/intake/[id]/files upload bytes → Blob key intake/{sessionId}/{fileName}
                 │                                 + manifest_entries row
                 │  POST /api/intake/[id]/preflight  pairing / duplicates / cost+time
                 ▼
            POST /api/intake/[id]/start
                 │
                 ▼
            startBatch  (lib/db/services/startBatch.ts) — ONE transaction
                 │  • insert batch (processing)
                 │  • pairCases(manifest) → one case per COMPLETE application+label pair
                 │  • insert case_files with object_key = intake/{sessionId}/{fileName}  ◄── WIRED
                 │    (exactly the key the upload route wrote — web & worker share it via Blob)
                 │  • (if application fields supplied) persist application.* extracted_fields
                 │  • case draft → queued ; session → processing ; audit event
                 ▼  enqueue one job per case AFTER commit (idempotencyKey = caseId)
            ┌─────────────── Postgres queue (queue_jobs / postgresOutbox) ───────────────┐
            ▼                                                                              │
   OFF-VERCEL WORKER  (worker/loop.ts → processCase.ts)                                    │
      claim (queued|retry_wait → extracting; guarded transition + append-only attempt)     │
      │                                                                                    │
      │  load label bytes from Blob (storage.get object_key)                               │
      │  model.extractLabel → ExtractedLabel                                               │
      │                                                                                    │
      │  load application:                                                                 │
      │     loadApplication(application.* fields)                                          │
      │       └─ if ABSENT → ensureApplication(): fetch application file bytes,            │
      │            model.extractApplication ON DEMAND, persist application.*  ◄── WIRED     │
      │                                                                                    │
      │  buildMatchReport(application, label)   ← SAME lib/engine oracle as /api/verify     │
      ▼                                                                                    │
   persist verdict (+ warning_evidence crop when GOVERNMENT WARNING uncertain)             │
   case → clean_match | has_mismatches | needs_review | failed | retry_wait | dead_letter  │
   finalizeAttempt (attempt succeeded/failed + audit), queue.ack/retry/deadLetter ─────────┘
            │
            ▼
   triage Work Queue (TriageTable) ─► reviewer opens Case Detail (DecisionHeader,
            FieldComparisonTable, WarningEvidence, EvidenceTimeline)
            │
            ▼
   recordDisposition (approve/reject/request-better-image; reason rules enforced + audited)
            │
            ▼
   generateExport (point-in-time CSV artifact → Blob)  ;  retentionPurge (phase-two, kill-switchable)
```

**The two newly wired seams** (previously real uploads finalized `failed`; they now SCORE):

1. **Object key handoff.** `startBatch` records `case_files.object_key` as
   `intake/{sessionId}/{fileName}` — byte-identical to what
   `app/api/intake/[id]/files/route.ts` wrote — so the worker's `storage.get` finds the bytes
   the web process uploaded (this is why a live demo needs **shared Blob**, not local disk).
2. **On-demand application extraction.** When a case has no pre-persisted `application.*`
   fields (the real-upload path stores application *bytes*, not extracted fields),
   `processCase.ensureApplication` fetches the application file and calls
   `model.extractApplication`, persisting the result so replays are cheap.

The offline smoke `tests/smoke/durablePath.test.ts` drives `startBatch → worker →
clean_match → disposition → export → dead-letter replay` deterministically over PGlite + memory
queue + fake storage + stub model, proving every seam connects in the gate.

---

## 5. Shared state machines & persistence model

**Batch lifecycle** (`lib/core/state/batch.ts`):
`draft → preflighting → ready_to_process → processing → (partially_failed) →
ready_for_review → review_in_progress → exported → archived → purge_eligible → purged`.

**Case lifecycle** (`lib/core/state/case.ts`):
`draft → queued → extracting → scoring → {clean_match | has_mismatches | needs_review}`;
failure arcs `→ retry_wait → queued` (bounded backoff) and `→ dead_letter → failed`; human
arc `→ disposition_recorded → archived → purged`; plus `needs_better_image` routing.

Transitions are enforced by `assert*Transition` at every API/worker mutation boundary, with
invalid-transition unit tests; the SQL `CHECK` constraints mirror the maps exactly. A duplicate
at-least-once delivery on an already-advanced case throws an invalid-transition error that the
worker catches and surfaces as a `{kind:"skipped"}` outcome — never a second verdict.

**Persistence model.** Domain aggregates (batches, cases, case_files, verdicts,
warning_evidence, dispositions, assignments, exports, retention_state) + an **append-only
`audit_events`** table; the queue is a Postgres outbox (`queue_jobs`); intake is
`intake_sessions` + `manifest_entries`. ~17 tables across migrations `0001_init`, `0002_auth`,
`0003_queue`, `0004_intake`. All access goes through the **driver-agnostic seam**
(`Queryable`/`DbClient`): repositories take a `Queryable` and never own transactions;
service-commands (`startBatch`, `finalizeAttempt`, `recordDisposition`, `generateExport`,
`replayJob`, `retentionPurge`) own `transaction()` so a state change and its audit event commit
in one unit of work. The same repository code runs unchanged on **PGlite** (offline tests) and
**`pg` Pool** (validated against Neon: 17 tables, migrations 0001–0004, seeded users).

---

## 6. Auth/authz, observability, brakes

- **Auth.** Auth.js (NextAuth v5) Credentials provider, scrypt password hashes
  (`lib/auth/password.ts`), Postgres-backed reviewer/admin roles. `auth.config.ts` is the
  edge-safe slice (no `pg`/`crypto`) used by `middleware.ts`; `auth.ts` adds the DB-backed
  provider on the Node runtime. Route gating (`/reviewer`, `/admin`) is active **only** when
  `DURABLE_BATCH=1`; authorization is aggregate-scoped (a reviewer sees the batches/cases
  assigned to them; admin actions require the admin role + a recorded reason where the UI
  demands one).
- **Observability.** `lib/observability/trace.ts` defines one correlation-id vocabulary
  (trace id + batch/case/intake-session/job/attempt/export ids) threaded through logs, queue
  payloads, DB rows, and model-call metadata. The worker exposes `GET /healthz` (200
  ok/starting, 503 unhealthy) for host probes and the ops-console heartbeat.
- **Kill switches & limits.** `lib/flags.ts` is the single source for the `DURABLE_BATCH`
  rollout flag plus runtime brakes (`WORKER_PROCESSING_DISABLED`, `MODEL_CALLS_DISABLED`,
  `REPLAY_DISABLED`, `EXPORTS_DISABLED`, `PURGE_KILL_SWITCH`), surfaced in the admin Settings
  panel. `lib/config/limits.ts` holds per-stage concurrency, spend caps, and latency targets.

---

## 7. Deployment topology

```
        push to GitHub main ──► Vercel GitHub integration ──► auto-deploy
                                         │
                                         ▼
   ┌──────────────────────────── Vercel (UI / API) ────────────────────────────┐
   │  Always-on core: /, /api/verify, /api/extract-application  (OPENAI_API_KEY) │
   │  Durable area (ONLY if DURABLE_BATCH=1): (reviewer)/*, /api/intake/*, /login │
   └────────────────────────────────────────────────────────────────────────────┘
                    │ (durable layer only)        │
                    ▼                              ▼
              Postgres (DATABASE_URL)        Vercel Blob (BLOB_READ_WRITE_TOKEN,
              source of truth                STORAGE_PROVIDER=vercel-blob)
                    ▲                              ▲
                    │      shared queue + objects  │
                    └──────────────┬───────────────┘
                                   │
                      OFF-VERCEL WORKER  (npm run worker; poll loop + /healthz)
                      ── NOT on the graded Vercel deploy ──
```

**Honest production note.** The **graded** deploy runs Tier A only: `DURABLE_BATCH` is
**off**, so the reviewer/admin routes are hidden (`/login` 200, `/` 200, `/api/verify` 405 for
GET, `/reviewer/queue` 404). Tier B is **not fully runnable on Vercel alone**: the worker is a
long-lived OFF-Vercel poll process and Vercel has no place to run it. A live durable demo
needs: (a) a provisioned Postgres (`DATABASE_URL`), (b) `AUTH_SECRET`, (c) **Vercel Blob**
(`BLOB_READ_WRITE_TOKEN` + `STORAGE_PROVIDER=vercel-blob`) so the web process and the separate
worker share the uploaded bytes, and (d) the worker running on some host (`npm run worker`).
A **Vercel Cron** hitting a serverless "queue tick" route is the documented path to run the
durable layer on Vercel alone — but that route is **not built yet**; it is the option, not a
claim.

---

## 8. How this maps to the planning docs

- [`docs/designs/production-gap-closure.md`](docs/designs/production-gap-closure.md) — the locked
  production plan (state machines, traceability, brakes, naming trajectory) this tier
  implements.
- [`docs/designs/stage-1-preflight.md`](docs/designs/stage-1-preflight.md) — provider preflight
  (Vercel Queues/Blob/Postgres pooling, Auth.js, worker artifact contract, deferred E2E).
- [`docs/designs/observability-and-rollout.md`](docs/designs/observability-and-rollout.md) —
  trace ids, metrics, alerts, rollout/rollback, secret rotation.
- [`docs/designs/government-migration-roadmap.md`](docs/designs/government-migration-roadmap.md) —
  per-seam swaps (identity, in-boundary model, no-outbound network, SIEM, formal retention) to
  a government posture.
- [`DESIGN.md`](DESIGN.md) — the operational design system for the reviewer/admin workbench.
