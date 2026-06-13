import { assertBatchTransition, type BatchState } from "@/lib/core/state/batch";
import type { Queryable } from "@/lib/db/client";

/** A row from the `batches` table. */
export interface BatchRow {
  id: string;
  name: string | null;
  owner_user_id: string;
  status: BatchState;
  intake_session_id: string | null;
  manifest_hash: string | null;
  created_at: string;
  updated_at: string;
}

/** Fields accepted when creating a batch. `status` defaults to `draft`. */
export interface InsertBatchInput {
  id: string;
  name?: string | null;
  ownerUserId: string;
  status?: BatchState;
  intakeSessionId?: string | null;
  manifestHash?: string | null;
}

/**
 * Repository for the `batches` aggregate.
 *
 * Every function takes a `Queryable` first arg so it composes inside a
 * `transaction()` owned by a service-command module (plan: "Transaction
 * ownership"). These functions never open transactions themselves.
 */

export async function insertBatch(
  db: Queryable,
  input: InsertBatchInput
): Promise<BatchRow> {
  const res = await db.query<BatchRow>(
    `insert into batches
       (id, name, owner_user_id, status, intake_session_id, manifest_hash)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      input.id,
      input.name ?? null,
      input.ownerUserId,
      input.status ?? "draft",
      input.intakeSessionId ?? null,
      input.manifestHash ?? null,
    ]
  );
  return res.rows[0];
}

export async function getBatch(
  db: Queryable,
  id: string
): Promise<BatchRow | null> {
  const res = await db.query<BatchRow>(
    "select * from batches where id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

/**
 * Move a batch to `next`, enforcing the shared batch state machine.
 *
 * Reads the current status, asserts `current -> next` is a legal transition
 * (throws otherwise), then writes. Returns the updated row, or null if no batch
 * with `id` exists.
 */
export async function setBatchStatus(
  db: Queryable,
  id: string,
  next: BatchState
): Promise<BatchRow | null> {
  const current = await getBatch(db, id);
  if (!current) return null;

  assertBatchTransition(current.status, next);

  const res = await db.query<BatchRow>(
    `update batches
        set status = $2, updated_at = now()
      where id = $1
      returning *`,
    [id, next]
  );
  return res.rows[0] ?? null;
}

export async function listBatchesByOwner(
  db: Queryable,
  ownerUserId: string
): Promise<BatchRow[]> {
  const res = await db.query<BatchRow>(
    `select * from batches
      where owner_user_id = $1
      order by created_at desc`,
    [ownerUserId]
  );
  return res.rows;
}
