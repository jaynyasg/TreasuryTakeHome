-- 0003_queue: Postgres-backed outbox queue (the named fallback behind the
-- QueueAdapter; see docs/designs/stage-1-preflight.md §2 Queue).
--
-- This table IS the queue when QUEUE_PROVIDER=outbox: the worker polls it in
-- poll mode (lib/adapters/queue/postgresOutbox.ts). It reuses the shared
-- Postgres already required by Stage 2, so the fallback adds no new dependency.
--
-- Conventions mirror 0001_init:
--   * Primary key is the app-supplied `text` job id (propagated through logs for
--     traceability); no gen_random_uuid()/pgcrypto (PGlite may lack it).
--   * `state` is `text` with a CHECK whose value list mirrors EXACTLY the states
--     in lib/adapters/queue/types.ts ('ready','inflight','done','dead_letter').
--   * timestamps are timestamptz defaulting to now().
--   * `create table if not exists` keeps re-runs harmless; the _migrations
--     ledger also guards.
--
-- Queue semantics encoded here:
--   * idempotency_key UNIQUE => enqueue is idempotent via INSERT ... ON CONFLICT
--     DO NOTHING (refresh/retry/double-submit cannot enqueue a duplicate).
--   * visible_at is the poll-mode visibility gate: a row is claimable only when
--     state='ready' AND visible_at <= now(). claim() pushes visible_at into the
--     future (now + visibility timeout) so an unacked job reappears.
--   * attempts is the delivery/retry counter; retry() increments it.
--   * dead_letter_reason preserves the poison-job failure for admin replay.
create table if not exists queue_jobs (
  id                 text primary key,
  type               text not null,
  payload            jsonb,
  idempotency_key    text not null unique,
  state              text not null default 'ready' check (state in (
                       'ready',
                       'inflight',
                       'done',
                       'dead_letter'
                     )),
  attempts           integer not null default 0,
  visible_at         timestamptz not null default now(),
  claimed_at         timestamptz,
  dead_letter_reason text,
  created_at         timestamptz not null default now()
);

-- Drives the poll-mode claim query: WHERE state='ready' AND visible_at<=now()
-- ORDER BY visible_at (plan "Index plan": job state/next_attempt_at).
create index if not exists idx_queue_jobs_state_visible
  on queue_jobs (state, visible_at);
