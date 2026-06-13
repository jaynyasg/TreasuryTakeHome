import type { Queryable } from "@/lib/db/client";

/** The worker stage an attempt belongs to. */
export type ProcessingStage = "extracting" | "scoring";

/** Lifecycle state of a single attempt. */
export type AttemptState = "running" | "succeeded" | "failed" | "dead_letter";

/** A row from the append-only `processing_attempts` table. */
export interface ProcessingAttemptRow {
  id: string;
  case_id: string;
  stage: ProcessingStage;
  attempt_no: number;
  state: AttemptState;
  error_class: string | null;
  error_detail: string | null;
  next_attempt_at: string | null;
  trace_id: string | null;
  created_at: string;
}

/** Fields accepted when starting a new attempt. */
export interface StartAttemptInput {
  id: string;
  caseId: string;
  stage: ProcessingStage;
  traceId?: string | null;
}

/** Fields accepted when completing an in-flight attempt. */
export interface CompleteAttemptInput {
  state: AttemptState;
  errorClass?: string | null;
  errorDetail?: string | null;
  nextAttemptAt?: string | null;
}

/**
 * Repository for the `processing_attempts` aggregate: append-only worker attempt
 * history. Replay "appends new attempts and never overwrites old evidence"
 * (plan), so we only INSERT new attempts and UPDATE an in-flight attempt's
 * terminal outcome — we never delete history.
 *
 * Every function takes a `Queryable` first arg so it composes inside a
 * service-owned `transaction()` (plan: "Transaction ownership"). No
 * transactions are opened here.
 */

/**
 * Insert a fresh `running` attempt for `case + stage`, minting `attempt_no` as
 * one past the current max for that pair (1 for the first attempt). Prior
 * attempts are left untouched (append-only history).
 */
export async function startAttempt(
  db: Queryable,
  input: StartAttemptInput
): Promise<ProcessingAttemptRow> {
  const res = await db.query<ProcessingAttemptRow>(
    `insert into processing_attempts
       (id, case_id, stage, attempt_no, state, trace_id)
     values (
       $1,
       $2,
       $3,
       coalesce(
         (select max(attempt_no) from processing_attempts
           where case_id = $2 and stage = $3),
         0
       ) + 1,
       'running',
       $4
     )
     returning *`,
    [input.id, input.caseId, input.stage, input.traceId ?? null]
  );
  return res.rows[0];
}

/**
 * Mark an attempt complete by writing its terminal `state` (and optional error /
 * backoff fields). This is the only UPDATE on the table — it records the outcome
 * of an existing in-flight attempt; it never deletes or rewrites prior rows.
 * Returns the updated row, or null if no attempt with `id` exists.
 */
export async function completeAttempt(
  db: Queryable,
  id: string,
  outcome: CompleteAttemptInput
): Promise<ProcessingAttemptRow | null> {
  const res = await db.query<ProcessingAttemptRow>(
    `update processing_attempts
        set state = $2,
            error_class = $3,
            error_detail = $4,
            next_attempt_at = $5
      where id = $1
      returning *`,
    [
      id,
      outcome.state,
      outcome.errorClass ?? null,
      outcome.errorDetail ?? null,
      outcome.nextAttemptAt ?? null,
    ]
  );
  return res.rows[0] ?? null;
}

/** List a case's attempts across all stages, oldest first (full history). */
export async function listAttempts(
  db: Queryable,
  caseId: string
): Promise<ProcessingAttemptRow[]> {
  const res = await db.query<ProcessingAttemptRow>(
    `select * from processing_attempts
      where case_id = $1
      order by created_at asc, attempt_no asc`,
    [caseId]
  );
  return res.rows;
}

/** Count how many attempts a case has accrued at a given stage. */
export async function countAttempts(
  db: Queryable,
  caseId: string,
  stage: ProcessingStage
): Promise<number> {
  const res = await db.query<{ count: string }>(
    `select count(*)::int as count from processing_attempts
      where case_id = $1 and stage = $2`,
    [caseId, stage]
  );
  return Number(res.rows[0]?.count ?? 0);
}
