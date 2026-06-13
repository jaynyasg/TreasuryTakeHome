-- 0001_init: initial relational schema for durable batch label verification.
--
-- Source of truth for batches, cases, files, processing attempts, extraction,
-- verdicts, warning evidence, dispositions, assignments, exports, retention,
-- and append-only audit events (plan: "Persistence organization", "Index plan",
-- "Audit events").
--
-- Conventions:
--   * Primary keys are app-supplied `text` ids (UUID-style strings). We do NOT
--     use gen_random_uuid()/pgcrypto: PGlite (the test engine) may lack pgcrypto,
--     and the plan's traceability requirement wants ids minted by the app and
--     propagated through logs/queue/object metadata anyway.
--   * State columns are `text` with CHECK constraints whose value lists mirror
--     EXACTLY the arrays in lib/core/state/batch.ts and lib/core/state/case.ts.
--   * created_at/updated_at are timestamptz.
--   * `create table if not exists` keeps re-runs harmless; the migration runner
--     also guards via the _migrations ledger.

-- users -----------------------------------------------------------------------
create table if not exists users (
  id          text primary key,
  email       text not null unique,
  name        text,
  role        text not null check (role in ('reviewer', 'admin')),
  created_at  timestamptz not null default now()
);

-- batches ---------------------------------------------------------------------
-- status mirrors BATCH_STATES (lib/core/state/batch.ts).
create table if not exists batches (
  id                 text primary key,
  name               text,
  owner_user_id      text not null references users(id),
  status             text not null check (status in (
                        'draft',
                        'preflighting',
                        'ready_to_process',
                        'processing',
                        'partially_failed',
                        'ready_for_review',
                        'review_in_progress',
                        'exported',
                        'archived',
                        'purge_eligible',
                        'purged'
                     )),
  intake_session_id  text,
  manifest_hash      text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- cases -----------------------------------------------------------------------
-- status mirrors CASE_STATES (lib/core/state/case.ts).
create table if not exists cases (
  id                text primary key,
  batch_id          text not null references batches(id),
  status            text not null check (status in (
                       'draft',
                       'queued',
                       'extracting',
                       'scoring',
                       'needs_review',
                       'has_mismatches',
                       'clean_match',
                       'disposition_recorded',
                       'archived',
                       'purged',
                       'retry_wait',
                       'dead_letter',
                       'failed',
                       'needs_better_image'
                    )),
  severity          text check (severity in ('red', 'amber', 'green')),
  assigned_user_id  text references users(id),
  brand             text,
  class_type        text,
  applicant         text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- case_files ------------------------------------------------------------------
-- object-manifest rows: the manifest is the source of truth for object
-- existence, not the blob store (plan: "Storage consistency").
create table if not exists case_files (
  id               text primary key,
  case_id          text not null references cases(id),
  kind             text not null check (kind in ('application', 'label')),
  object_provider  text,
  object_key       text,
  checksum         text,
  size_bytes       bigint,
  content_type     text,
  retention_state  text,
  created_at       timestamptz not null default now()
);

-- processing_attempts ---------------------------------------------------------
-- append-only worker attempt history; never updated in place (plan: replay
-- "appends new attempts and never overwrites old evidence").
create table if not exists processing_attempts (
  id              text primary key,
  case_id         text not null references cases(id),
  stage           text not null check (stage in ('extracting', 'scoring')),
  attempt_no      integer not null,
  state           text not null check (state in (
                     'running',
                     'succeeded',
                     'failed',
                     'dead_letter'
                  )),
  error_class     text,
  error_detail    text,
  next_attempt_at timestamptz,
  trace_id        text,
  created_at      timestamptz not null default now()
);

-- extracted_fields ------------------------------------------------------------
create table if not exists extracted_fields (
  id          text primary key,
  case_id     text not null references cases(id),
  field_name  text not null,
  field_value text,
  confidence  numeric,
  created_at  timestamptz not null default now()
);

-- verdicts --------------------------------------------------------------------
create table if not exists verdicts (
  id               text primary key,
  case_id          text not null references cases(id),
  overall          text,
  match_percent    numeric,
  payload          jsonb,
  ruleset_version  text,
  created_at       timestamptz not null default now()
);

-- warning_evidence ------------------------------------------------------------
create table if not exists warning_evidence (
  id                   text primary key,
  case_id              text not null references cases(id),
  crop_object_key      text,
  lead_in_detected     boolean,
  boldness_confidence  numeric,
  uncertainty_reason   text,
  verdict              text,
  created_at           timestamptz not null default now()
);

-- dispositions ----------------------------------------------------------------
create table if not exists dispositions (
  id             text primary key,
  case_id        text not null references cases(id),
  actor_user_id  text not null references users(id),
  action         text not null check (action in (
                    'approve',
                    'reject',
                    'request_better_image'
                 )),
  reason         text,
  created_at     timestamptz not null default now()
);

-- assignments -----------------------------------------------------------------
create table if not exists assignments (
  id                  text primary key,
  batch_id            text not null references batches(id),
  user_id             text not null references users(id),
  assignment_version  integer not null default 1,
  created_at          timestamptz not null default now()
);

-- exports ---------------------------------------------------------------------
create table if not exists exports (
  id                 text primary key,
  batch_id           text not null references batches(id),
  requested_by       text not null references users(id),
  status             text not null check (status in (
                        'generating',
                        'complete',
                        'partial',
                        'failed'
                     )),
  object_key         text,
  included_case_ids  jsonb,
  ruleset_versions   jsonb,
  created_at         timestamptz not null default now()
);

-- retention_state -------------------------------------------------------------
-- two-phase purge bookkeeping with deletion tombstones (plan: "Retention purge").
create table if not exists retention_state (
  id                text primary key,
  aggregate_type    text not null,
  aggregate_id      text not null,
  purge_eligible_at timestamptz,
  purged_at         timestamptz,
  tombstone         jsonb,
  created_at        timestamptz not null default now()
);

-- audit_events ----------------------------------------------------------------
-- APPEND ONLY. Sensitive actions write actor/action/aggregate + before/after
-- summaries, reason, trace id, and request metadata (plan: "Audit events").
create table if not exists audit_events (
  id              text primary key,
  actor_user_id   text,
  action          text not null,
  aggregate_type  text not null,
  aggregate_id    text not null,
  before_summary  jsonb,
  after_summary   jsonb,
  reason          text,
  trace_id        text,
  source_ip       text,
  user_agent      text,
  created_at      timestamptz not null default now()
);

-- indexes (plan: "Index plan") ------------------------------------------------
create index if not exists idx_batches_owner_status_created
  on batches (owner_user_id, status, created_at);

create index if not exists idx_cases_batch_status_sev_assignee
  on cases (batch_id, status, severity, assigned_user_id);

create index if not exists idx_processing_attempts_state_next
  on processing_attempts (state, next_attempt_at);

create index if not exists idx_case_files_retention_objectkey
  on case_files (retention_state, object_key);

create index if not exists idx_exports_batch_created
  on exports (batch_id, created_at);

create index if not exists idx_audit_events_aggregate_created
  on audit_events (aggregate_type, aggregate_id, created_at);

create index if not exists idx_retention_state_purge_eligible
  on retention_state (purge_eligible_at);
