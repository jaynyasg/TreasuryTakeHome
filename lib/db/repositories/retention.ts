import type { Queryable } from "@/lib/db/client";

/** A row from the `retention_state` table. `tombstone` is a jsonb column:
 *  PGlite/pg return it already parsed. */
export interface RetentionStateRow {
  id: string;
  aggregate_type: string;
  aggregate_id: string;
  purge_eligible_at: string | null;
  purged_at: string | null;
  tombstone: unknown;
  created_at: string;
}

/** Fields accepted when marking an aggregate purge-eligible. */
export interface MarkPurgeEligibleInput {
  id: string;
  aggregateType: string;
  aggregateId: string;
  purgeEligibleAt: string | Date;
}

/**
 * Repository for the `retention_state` aggregate: two-phase purge bookkeeping
 * with deletion tombstones (plan: "Retention purge"). Each function takes a
 * `Queryable` first so it composes inside a service-owned `transaction()`. No
 * transactions are opened here.
 */

/**
 * Record that an aggregate becomes eligible for purge at `purgeEligibleAt`.
 * `purged_at`/`tombstone` stay null until {@link recordPurge} runs.
 */
export async function markPurgeEligible(
  db: Queryable,
  input: MarkPurgeEligibleInput
): Promise<RetentionStateRow> {
  const eligibleAt =
    input.purgeEligibleAt instanceof Date
      ? input.purgeEligibleAt.toISOString()
      : input.purgeEligibleAt;

  const res = await db.query<RetentionStateRow>(
    `insert into retention_state
       (id, aggregate_type, aggregate_id, purge_eligible_at)
     values ($1, $2, $3, $4)
     returning *`,
    [input.id, input.aggregateType, input.aggregateId, eligibleAt]
  );
  return res.rows[0];
}

/**
 * List rows whose purge window has opened as of `asOf` and which have not yet
 * been purged (`purge_eligible_at <= asOf AND purged_at IS NULL`), oldest
 * eligible first so the purger drains the backlog in order.
 */
export async function listPurgeEligible(
  db: Queryable,
  asOf: string | Date
): Promise<RetentionStateRow[]> {
  const at = asOf instanceof Date ? asOf.toISOString() : asOf;
  const res = await db.query<RetentionStateRow>(
    `select * from retention_state
      where purge_eligible_at <= $1
        and purged_at is null
      order by purge_eligible_at asc`,
    [at]
  );
  return res.rows;
}

/**
 * Record completion of a purge: stamp `purged_at` (now) and store the deletion
 * `tombstone` (jsonb summary of what was removed). Returns the updated row, or
 * null if no row with `id` exists.
 */
export async function recordPurge(
  db: Queryable,
  id: string,
  tombstone: unknown
): Promise<RetentionStateRow | null> {
  const res = await db.query<RetentionStateRow>(
    `update retention_state
        set purged_at = now(),
            tombstone = $2
      where id = $1
      returning *`,
    [id, tombstone]
  );
  return res.rows[0] ?? null;
}
