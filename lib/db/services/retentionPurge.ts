import { randomUUID } from "node:crypto";
import type { DbClient, Queryable } from "@/lib/db/client";
import type { StorageAdapter } from "@/lib/adapters/storage/types";

import {
  listPurgeEligible,
  recordPurge,
  type RetentionStateRow,
} from "@/lib/db/repositories/retention";
import { listCaseFiles } from "@/lib/db/repositories/caseFiles";
import { appendAuditEvent } from "@/lib/db/repositories/auditEvents";

/** A purge-eligible aggregate, identified by its retention row + target. */
export interface PurgeEligible {
  /** The retention_state row id (the unit {@link executePurge} purges). */
  retentionId: string;
  aggregateType: string;
  aggregateId: string;
}

/** Result of {@link previewPurge}: what WOULD be purged, with per-type counts. */
export interface PreviewPurgeResult {
  eligible: PurgeEligible[];
  /** Count of eligible records per aggregate type (e.g. `{ case: 3 }`). */
  counts: Record<string, number>;
}

/** Arguments to {@link executePurge}. */
export interface ExecutePurgeArgs {
  /** Retention row ids (from {@link previewPurge}) to purge. */
  ids: string[];
  /** Admin performing the purge (recorded on each tombstone + audit event). */
  actorUserId: string;
  /** Required justification, preserved in the tombstone + audit trail. */
  reason: string;
  /** When true, the purge kill switch is engaged: delete NOTHING. */
  killSwitchOn: boolean;
  /** Trace id propagated into the audit events. */
  traceId?: string | null;
}

/** Result of {@link executePurge}. */
export interface ExecutePurgeResult {
  /** Records actually purged (tombstoned). */
  purged: number;
  /** Records skipped (kill switch on, already purged, or no longer eligible). */
  skipped: number;
}

/**
 * Phase 1 of two-phase retention purge (plan "Retention purge": "mark records
 * purge-eligible and show preview/counts, then delete/redact retrievable archive
 * data while preserving minimal tombstones"). READ-ONLY: lists the records whose
 * purge window has opened as of `asOf` and which have not yet been purged, with
 * per-aggregate-type counts. Deletes NOTHING.
 */
export async function previewPurge(
  db: Queryable,
  asOf: Date
): Promise<PreviewPurgeResult> {
  const rows = await listPurgeEligible(db, asOf);
  const eligible: PurgeEligible[] = rows.map(toEligible);
  const counts: Record<string, number> = {};
  for (const e of eligible) {
    counts[e.aggregateType] = (counts[e.aggregateType] ?? 0) + 1;
  }
  return { eligible, counts };
}

/**
 * Phase 2 of two-phase retention purge. For each requested retention record:
 *   1. best-effort DELETE the retrievable archive blobs (e.g. a case's stored
 *      object keys) — storage deletes are idempotent and never throw the txn,
 *   2. `recordPurge` writes a minimal TOMBSTONE (what was purged, when, by whom,
 *      reason, and the deleted object keys) — the tombstone is preserved for the
 *      deletion audit even though the underlying archive data is gone, and
 *   3. append an audit event.
 * Steps 2+3 commit in ONE transaction PER record, so a mid-batch failure on one
 * record leaves every already-purged record's tombstone intact and never
 * corrupts state (plan: "Transaction per record so a mid-batch failure doesn't
 * corrupt state").
 *
 * KILL SWITCH: when `killSwitchOn` is true this deletes NOTHING and skips every
 * record (plan "Operational brakes": runtime kill switch for purge). Early
 * accidental deletes are the failure mode this guards against.
 */
export async function executePurge(
  db: DbClient,
  storage: StorageAdapter,
  args: ExecutePurgeArgs
): Promise<ExecutePurgeResult> {
  // Kill switch: do nothing, skip everything.
  if (args.killSwitchOn) {
    return { purged: 0, skipped: args.ids.length };
  }

  let purged = 0;
  let skipped = 0;

  for (const retentionId of args.ids) {
    // Re-read each record so a concurrently-purged or unknown record is skipped
    // rather than double-purged.
    const row = await getRetentionRow(db, retentionId);
    if (!row || row.purged_at !== null) {
      skipped += 1;
      continue;
    }

    // Best-effort archive deletion: for a case aggregate, delete its stored
    // object keys. Deletes are idempotent (deleting a missing key is a no-op),
    // so this is safe to run before the tombstone commit.
    const deletedKeys = await deleteArchiveBlobs(db, storage, row);

    // Tombstone + audit commit together, per-record.
    await db.transaction(async (tx) => {
      const tombstone = {
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        purgedBy: args.actorUserId,
        reason: args.reason,
        deletedObjectKeys: deletedKeys,
        purgedAt: new Date().toISOString(),
      };

      const updated = await recordPurge(tx, row.id, tombstone);
      if (!updated) {
        throw new Error(`executePurge: retention row vanished: ${row.id}`);
      }

      await appendAuditEvent(tx, {
        id: randomUUID(),
        actorUserId: args.actorUserId,
        action: "retention.purge",
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
        afterSummary: {
          retentionId: row.id,
          deletedObjectKeys: deletedKeys,
        },
        reason: args.reason,
        traceId: args.traceId ?? null,
      });
    });

    purged += 1;
  }

  return { purged, skipped };
}

// --- helpers ---------------------------------------------------------------

function toEligible(row: RetentionStateRow): PurgeEligible {
  return {
    retentionId: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
  };
}

/** Fetch a single retention row by id (the unit a purge targets). */
async function getRetentionRow(
  db: Queryable,
  id: string
): Promise<RetentionStateRow | null> {
  const res = await db.query<RetentionStateRow>(
    "select * from retention_state where id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

/**
 * Delete the retrievable archive blobs for a purge-eligible aggregate and return
 * the object keys removed (recorded in the tombstone). For a `case` aggregate
 * these are its case-file object keys. Storage deletes are best-effort and
 * idempotent; a missing key is a no-op. Aggregate types without retrievable
 * blobs simply return an empty list.
 */
async function deleteArchiveBlobs(
  db: Queryable,
  storage: StorageAdapter,
  row: RetentionStateRow
): Promise<string[]> {
  if (row.aggregate_type !== "case") return [];

  const files = await listCaseFiles(db, row.aggregate_id);
  const deleted: string[] = [];
  for (const file of files) {
    if (!file.object_key) continue;
    await storage.delete(file.object_key);
    deleted.push(file.object_key);
  }
  return deleted;
}
