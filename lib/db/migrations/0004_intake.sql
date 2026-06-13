-- 0004_intake: durable Batch Intake Concierge state (plan T4; "Temporal
-- Decisions" → Idempotent intake / Resumable uploads).
--
-- Two tables back the intake session that precedes a durable batch:
--   * intake_sessions  — one row per intake attempt. The `idempotency_key`
--     UNIQUE is what makes intake idempotent: createIntakeSession does
--     INSERT ... ON CONFLICT (idempotency_key) DO NOTHING then SELECT, so a
--     refresh/retry/double-submit returns the EXISTING session rather than
--     creating a second one (plan "Idempotent intake"). `status` is a forward-
--     only lifecycle guarded in the repository.
--   * manifest_entries — the resumable upload manifest: every expected/uploaded
--     file with its classification and status. The manifest — not the blob
--     store — is the source of truth for what will be processed (plan "Storage
--     consistency" / "Resumable uploads").
--
-- Conventions mirror 0001_init / 0003_queue:
--   * Primary keys are app-supplied `text` ids (no gen_random_uuid()/pgcrypto;
--     PGlite may lack it; ids are minted by the app for traceability).
--   * `status`/`kind`/entry-status are `text` with CHECK lists that mirror the
--     domain types in lib/intake/types.ts and the session lifecycle below.
--   * timestamps are timestamptz defaulting to now().
--   * `create table if not exists` keeps re-runs harmless; the _migrations
--     ledger also guards.
--
-- Dedupe is handled in the domain (detectDuplicates by checksum), so NO unique
-- (intake_session_id, checksum) constraint is imposed here — a resumed upload of
-- the same bytes is recorded as a `duplicate` manifest row, not a DB error.

-- intake_sessions -------------------------------------------------------------
create table if not exists intake_sessions (
  id               text primary key,
  -- null until startBatch creates the batch this session becomes.
  batch_id         text references batches(id),
  -- UNIQUE => idempotent create (ON CONFLICT DO NOTHING then SELECT).
  idempotency_key  text not null unique,
  manifest_hash    text,
  status           text not null default 'draft' check (status in (
                     'draft',
                     'preflighting',
                     'ready',
                     'processing'
                   )),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- manifest_entries ------------------------------------------------------------
-- One row per uploaded/expected file. `kind` mirrors FileKind; `status` mirrors
-- ManifestEntryStatus (lib/intake/types.ts). `object_key` is null for entries
-- not stored (e.g. a `duplicate` skipped on resume, or a `missing` expected file).
create table if not exists manifest_entries (
  id                 text primary key,
  intake_session_id  text not null references intake_sessions(id),
  file_name          text not null,
  kind               text not null check (kind in (
                       'application',
                       'label',
                       'unknown'
                     )),
  case_key           text not null,
  checksum           text,
  size_bytes         bigint,
  content_type       text,
  status             text not null check (status in (
                       'uploaded',
                       'missing',
                       'invalid',
                       'duplicate',
                       'excluded'
                     )),
  object_key         text,
  created_at         timestamptz not null default now()
);

-- Drives listManifestEntries(intake_session_id) and the per-session preflight.
create index if not exists idx_manifest_entries_session
  on manifest_entries (intake_session_id);
