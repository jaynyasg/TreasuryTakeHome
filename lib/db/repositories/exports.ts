import type { Queryable } from "@/lib/db/client";

/** Lifecycle status of an export bundle (plan: "Export bundles"). */
export type ExportStatus = "generating" | "complete" | "partial" | "failed";

/** A row from the `exports` table. `included_case_ids` and `ruleset_versions`
 *  are jsonb columns: PGlite/pg return them already parsed. */
export interface ExportRow {
  id: string;
  batch_id: string;
  requested_by: string;
  status: ExportStatus;
  object_key: string | null;
  included_case_ids: string[] | null;
  ruleset_versions: string[] | null;
  created_at: string;
}

/** Fields accepted when starting an export. Status begins at `generating`. */
export interface InsertExportInput {
  id: string;
  batchId: string;
  requestedBy: string;
  includedCaseIds?: string[] | null;
  rulesetVersions?: string[] | null;
}

/** Options when advancing an export's status. */
export interface SetExportStatusOptions {
  objectKey?: string;
}

/**
 * Repository for the `exports` aggregate. Each function takes a `Queryable`
 * first so it composes inside a service-owned `transaction()` (plan:
 * "Transaction ownership"). No transactions are opened here.
 */

export async function insertExport(
  db: Queryable,
  input: InsertExportInput
): Promise<ExportRow> {
  const res = await db.query<ExportRow>(
    `insert into exports
       (id, batch_id, requested_by, status, object_key,
        included_case_ids, ruleset_versions)
     values ($1, $2, $3, 'generating', null, $4, $5)
     returning *`,
    [
      input.id,
      input.batchId,
      input.requestedBy,
      input.includedCaseIds ?? null,
      input.rulesetVersions ?? null,
    ]
  );
  return res.rows[0];
}

/**
 * Advance an export to a terminal (or interim) status. Pass `objectKey` once
 * the bundle is written to object storage; omitting it leaves the key
 * unchanged. Returns the updated row, or null if no export with `id` exists.
 */
export async function setExportStatus(
  db: Queryable,
  id: string,
  status: ExportStatus,
  options: SetExportStatusOptions = {}
): Promise<ExportRow | null> {
  const res = await db.query<ExportRow>(
    `update exports
        set status = $2,
            object_key = coalesce($3, object_key)
      where id = $1
      returning *`,
    [id, status, options.objectKey ?? null]
  );
  return res.rows[0] ?? null;
}

export async function getExport(
  db: Queryable,
  id: string
): Promise<ExportRow | null> {
  const res = await db.query<ExportRow>(
    "select * from exports where id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

/** List a batch's exports, most recent first. */
export async function listExportsByBatch(
  db: Queryable,
  batchId: string
): Promise<ExportRow[]> {
  const res = await db.query<ExportRow>(
    `select * from exports
      where batch_id = $1
      order by created_at desc`,
    [batchId]
  );
  return res.rows;
}
