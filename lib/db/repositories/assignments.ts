import type { Queryable } from "@/lib/db/client";

/** A row from the `assignments` table. */
export interface AssignmentRow {
  id: string;
  batch_id: string;
  user_id: string;
  assignment_version: number;
  created_at: string;
}

/** Fields accepted when creating an assignment. */
export interface InsertAssignmentInput {
  id: string;
  batchId: string;
  userId: string;
  assignmentVersion?: number;
}

/**
 * Raised when `reassign` finds the current `assignment_version` no longer
 * matches the caller's `expectedVersion` — i.e. someone else reassigned the
 * batch first. Callers should re-read and retry (plan: "Optimistic
 * concurrency"). Carries the batch id and the version that was expected.
 */
export class StaleAssignmentError extends Error {
  readonly batchId: string;
  readonly expectedVersion: number;

  constructor(batchId: string, expectedVersion: number) {
    super(
      `Stale assignment for batch ${batchId}: expected version ${expectedVersion}, ` +
        `but it has since changed. Re-read the assignment and retry.`
    );
    this.name = "StaleAssignmentError";
    this.batchId = batchId;
    this.expectedVersion = expectedVersion;
  }
}

/**
 * Repository for the `assignments` aggregate. Each function takes a `Queryable`
 * first so it composes inside a service-owned `transaction()` (plan:
 * "Transaction ownership"). No transactions are opened here.
 */

export async function insertAssignment(
  db: Queryable,
  input: InsertAssignmentInput
): Promise<AssignmentRow> {
  const res = await db.query<AssignmentRow>(
    `insert into assignments
       (id, batch_id, user_id, assignment_version)
     values ($1, $2, $3, $4)
     returning *`,
    [input.id, input.batchId, input.userId, input.assignmentVersion ?? 1]
  );
  return res.rows[0];
}

/** Current assignment for a batch, or null if unassigned. */
export async function getAssignment(
  db: Queryable,
  batchId: string
): Promise<AssignmentRow | null> {
  const res = await db.query<AssignmentRow>(
    "select * from assignments where batch_id = $1",
    [batchId]
  );
  return res.rows[0] ?? null;
}

/**
 * Reassign a batch to `userId` under optimistic concurrency: the update only
 * lands if the stored `assignment_version` still equals `expectedVersion`, and
 * it bumps the version by one. If no row matched (version moved on, or the
 * batch has no assignment), throws {@link StaleAssignmentError} and writes
 * nothing. Returns the updated row on success.
 */
export async function reassign(
  db: Queryable,
  batchId: string,
  userId: string,
  expectedVersion: number
): Promise<AssignmentRow> {
  const res = await db.query<AssignmentRow>(
    `update assignments
        set user_id = $2,
            assignment_version = assignment_version + 1
      where batch_id = $1
        and assignment_version = $3
      returning *`,
    [batchId, userId, expectedVersion]
  );
  const updated = res.rows[0];
  if (!updated) {
    throw new StaleAssignmentError(batchId, expectedVersion);
  }
  return updated;
}
