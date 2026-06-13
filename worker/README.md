# Worker Service — durable label-verification processing

Poll-mode worker that durably processes one label-verification **case** at a
time: load the case + its label file, extract the label via the model adapter,
run the deterministic scoring engine (the same `lib/engine` oracle the
`/api/verify` route uses), persist the verdict + evidence, and advance the case
through its shared state machine — with bounded retries, dead-letter for poison
jobs, and an explicit visible state for every failure.

This is **Stage 4** of `docs/designs/production-gap-closure.md`. The worker
artifact contract it implements is `docs/designs/stage-1-preflight.md` §3.

## Boundaries

- **Worker-safe core only.** Imports `lib/contract.ts`, `lib/engine/*`,
  `lib/core/state/*`, `lib/db/*`, `lib/adapters/*`. **No `next`/`react` imports.**
- The deterministic engine is reused verbatim (`buildMatchReport`) — the worker
  never re-implements scoring or warning rules.
- Provider SDKs stay behind the storage / queue / model adapters; the worker
  logic is composed from injected `WorkerDeps` so the offline test harness swaps
  in PGlite + fake storage + memory queue + a stub model.

## Local run

```bash
npm run worker          # tsx worker/index.ts — poll loop + /healthz server
```

Requires the env contract below (a real Postgres + queue + storage + model).
For a fully offline exercise of the processing logic, run the worker tests:

```bash
npx vitest run tests/worker/
```

## Build / container

```bash
docker build -f worker/Dockerfile -t ttb-worker .
docker run --rm -p 8080:8080 --env-file .env.local ttb-worker
```

The image is portable to any container host (Railway/Fly/Render first per the
plan's "fast prototype worker first", Azure-portable later).

## Environment contract

The authoritative env contract is **`docs/designs/stage-1-preflight.md` §3**.
The variables the worker reads:

| Var | Purpose | Required? |
|---|---|---|
| `DATABASE_URL` | Postgres connection (worker uses direct/pooled endpoint). | Yes |
| `QUEUE_PROVIDER` | `vercel` \| `outbox` \| `managed` — selects the `QueueAdapter`. | Yes |
| `STORAGE_PROVIDER` | `vercel-blob` \| fallback — selects the `StorageAdapter`. | Yes |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob access token. | Yes (vercel-blob) |
| `OPENAI_API_KEY` | GPT-4o label extraction. | Yes |
| `WORKER_MAX_ATTEMPTS` | Bounded-attempt budget before dead-letter (default 3). | No |
| `WORKER_POLL_INTERVAL_MS` | Poll interval between claims (default 2000). | No |
| `WORKER_PORT` / `PORT` | Health-server port (default 8080). | No |

`buildProductionDeps()` (worker/deps.ts) is the composition root that reads
these. It is typecheck-only — the test suite constructs its own fakes.

## `/healthz` contract

`GET /healthz` returns the health snapshot for host liveness/readiness probes
and the ops-console worker heartbeat:

```jsonc
{
  "status": "starting" | "ok" | "unhealthy",
  "lastPollAt": 1718200000000,   // epoch ms of last poll, null before first
  "processed": 42,               // outcomes processed since start
  "deadLetters": 1,              // dead-letters observed since start
  "lastError": null              // last loop error message, if any
}
```

HTTP **200** for `ok`/`starting`, **503** for `unhealthy` (stale poll or an
outstanding loop error). Readiness flips to `unhealthy` when the last poll is
older than the stale window or a poll error is outstanding.

## Outcome routing (processCaseJob)

| Model result | Queue action | Case state | Verdict row? |
|---|---|---|---|
| `ok:true` | `ack` | `clean_match` \| `has_mismatches` \| `needs_review` | yes |
| `malformed` / `refusal` / `empty` | `ack` | `needs_review` (`scoring`→) | **no** (no misleading score) |
| application unavailable (post-extract) | `ack` | `failed` | no |
| `timeout`, attempts remain | `retry(backoff)` | `retry_wait` | no |
| `timeout`, budget spent | `deadLetter` | `dead_letter` → `failed` | no |
| invalid payload / missing case | `deadLetter` | (unchanged) | no |
| already-terminal case (duplicate delivery) | `ack` | unchanged (skipped) | no |

Every transition is guarded by the shared case state machine
(`assertCaseTransition`) and written with an append-only `processing_attempts`
row + audit event in the same unit of work via `finalizeAttempt`.
