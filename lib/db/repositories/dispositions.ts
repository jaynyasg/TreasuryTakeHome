import type { Queryable } from "@/lib/db/client";

/** Agent action recorded against a case (plan: "Disposition"). */
export type DispositionAction = "approve" | "reject" | "request_better_image";

/** A row from the `dispositions` table. */
export interface DispositionRow {
  id: string;
  case_id: string;
  actor_user_id: string;
  action: DispositionAction;
  reason: string | null;
  created_at: string;
}

/** Fields accepted when recording a disposition. */
export interface InsertDispositionInput {
  id: string;
  caseId: string;
  actorUserId: string;
  action: DispositionAction;
  reason?: string | null;
}

/**
 * Repository for the `dispositions` aggregate. Each function takes a `Queryable`
 * first so it composes inside a service-owned `transaction()` (plan:
 * "Transaction ownership"). No transactions are opened here.
 */

export async function insertDisposition(
  db: Queryable,
  input: InsertDispositionInput
): Promise<DispositionRow> {
  const res = await db.query<DispositionRow>(
    `insert into dispositions
       (id, case_id, actor_user_id, action, reason)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [
      input.id,
      input.caseId,
      input.actorUserId,
      input.action,
      input.reason ?? null,
    ]
  );
  return res.rows[0];
}

/** Most-recent disposition for a case, or null if none recorded yet. */
export async function getLatestDisposition(
  db: Queryable,
  caseId: string
): Promise<DispositionRow | null> {
  const res = await db.query<DispositionRow>(
    `select * from dispositions
      where case_id = $1
      order by created_at desc
      limit 1`,
    [caseId]
  );
  return res.rows[0] ?? null;
}

/** All dispositions for a case, oldest first (chronological trail). */
export async function listDispositions(
  db: Queryable,
  caseId: string
): Promise<DispositionRow[]> {
  const res = await db.query<DispositionRow>(
    `select * from dispositions
      where case_id = $1
      order by created_at asc`,
    [caseId]
  );
  return res.rows;
}
