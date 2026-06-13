import type { Queryable } from "@/lib/db/client";

/** Which side of the application/label pair a file belongs to. */
export type CaseFileKind = "application" | "label";

/** A row from the `case_files` object-manifest table. */
export interface CaseFileRow {
  id: string;
  case_id: string;
  kind: CaseFileKind;
  object_provider: string | null;
  object_key: string | null;
  checksum: string | null;
  size_bytes: number | null;
  content_type: string | null;
  retention_state: string | null;
  created_at: string;
}

/** Fields accepted when inserting a case file manifest row. */
export interface InsertCaseFileInput {
  id: string;
  caseId: string;
  kind: CaseFileKind;
  objectProvider?: string | null;
  objectKey?: string | null;
  checksum?: string | null;
  sizeBytes?: number | null;
  contentType?: string | null;
  retentionState?: string | null;
}

/**
 * Repository for the `case_files` aggregate: the object manifest is the source
 * of truth for object existence, not the blob store (plan: "Storage
 * consistency").
 *
 * Every function takes a `Queryable` first arg so it composes inside a
 * service-owned `transaction()` (plan: "Transaction ownership"). No
 * transactions are opened here.
 */

export async function insertCaseFile(
  db: Queryable,
  file: InsertCaseFileInput
): Promise<CaseFileRow> {
  const res = await db.query<CaseFileRow>(
    `insert into case_files
       (id, case_id, kind, object_provider, object_key, checksum,
        size_bytes, content_type, retention_state)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     returning *`,
    [
      file.id,
      file.caseId,
      file.kind,
      file.objectProvider ?? null,
      file.objectKey ?? null,
      file.checksum ?? null,
      file.sizeBytes ?? null,
      file.contentType ?? null,
      file.retentionState ?? null,
    ]
  );
  return res.rows[0];
}

/** List a case's files, oldest first. */
export async function listCaseFiles(
  db: Queryable,
  caseId: string
): Promise<CaseFileRow[]> {
  const res = await db.query<CaseFileRow>(
    `select * from case_files
      where case_id = $1
      order by created_at asc`,
    [caseId]
  );
  return res.rows;
}

export async function getCaseFile(
  db: Queryable,
  id: string
): Promise<CaseFileRow | null> {
  const res = await db.query<CaseFileRow>(
    "select * from case_files where id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

/**
 * List files in a given retention state (e.g. purge sweep candidates). Uses the
 * (retention_state, object_key) index; ordered by object_key for stable paging.
 */
export async function listFilesByRetentionState(
  db: Queryable,
  retentionState: string
): Promise<CaseFileRow[]> {
  const res = await db.query<CaseFileRow>(
    `select * from case_files
      where retention_state = $1
      order by object_key asc`,
    [retentionState]
  );
  return res.rows;
}
