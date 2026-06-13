import { assertCaseTransition, type CaseState } from "@/lib/core/state/case";
import type { Queryable } from "@/lib/db/client";

/** Severity bucket; null until a verdict assigns one. */
export type CaseSeverity = "red" | "amber" | "green";

/** A row from the `cases` table. */
export interface CaseRow {
  id: string;
  batch_id: string;
  status: CaseState;
  severity: CaseSeverity | null;
  assigned_user_id: string | null;
  brand: string | null;
  class_type: string | null;
  applicant: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields accepted when creating a case. `status` defaults to `draft`. */
export interface InsertCaseInput {
  id: string;
  batchId: string;
  status?: CaseState;
  severity?: CaseSeverity | null;
  assignedUserId?: string | null;
  brand?: string | null;
  classType?: string | null;
  applicant?: string | null;
}

/**
 * Repository for the `cases` aggregate. Each function takes a `Queryable` first
 * so it composes inside a service-owned `transaction()` (plan: "Transaction
 * ownership"). No transactions are opened here.
 */

export async function insertCase(
  db: Queryable,
  input: InsertCaseInput
): Promise<CaseRow> {
  const res = await db.query<CaseRow>(
    `insert into cases
       (id, batch_id, status, severity, assigned_user_id, brand, class_type, applicant)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     returning *`,
    [
      input.id,
      input.batchId,
      input.status ?? "draft",
      input.severity ?? null,
      input.assignedUserId ?? null,
      input.brand ?? null,
      input.classType ?? null,
      input.applicant ?? null,
    ]
  );
  return res.rows[0];
}

export async function getCase(
  db: Queryable,
  id: string
): Promise<CaseRow | null> {
  const res = await db.query<CaseRow>("select * from cases where id = $1", [id]);
  return res.rows[0] ?? null;
}

/**
 * Move a case to `next`, enforcing the shared case state machine. Reads current
 * status, asserts the transition (throws on invalid), then writes. Returns the
 * updated row, or null when no case with `id` exists.
 */
export async function setCaseStatus(
  db: Queryable,
  id: string,
  next: CaseState
): Promise<CaseRow | null> {
  const current = await getCase(db, id);
  if (!current) return null;

  assertCaseTransition(current.status, next);

  const res = await db.query<CaseRow>(
    `update cases
        set status = $2, updated_at = now()
      where id = $1
      returning *`,
    [id, next]
  );
  return res.rows[0] ?? null;
}

/**
 * List a batch's cases triage-ordered: severity bucket red, amber, green (nulls
 * last), then most-recently-updated first. Matches the Work Queue sort
 * (plan: "Triage rendering").
 */
export async function listCasesByBatch(
  db: Queryable,
  batchId: string
): Promise<CaseRow[]> {
  const res = await db.query<CaseRow>(
    `select * from cases
      where batch_id = $1
      order by
        case severity
          when 'red'   then 0
          when 'amber' then 1
          when 'green' then 2
          else 3
        end,
        updated_at desc`,
    [batchId]
  );
  return res.rows;
}

/** Assign (or reassign) a case to a user. Pass null to unassign. */
export async function assignCase(
  db: Queryable,
  id: string,
  userId: string | null
): Promise<CaseRow | null> {
  const res = await db.query<CaseRow>(
    `update cases
        set assigned_user_id = $2, updated_at = now()
      where id = $1
      returning *`,
    [id, userId]
  );
  return res.rows[0] ?? null;
}
