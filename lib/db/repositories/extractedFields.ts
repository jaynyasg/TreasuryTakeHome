import type { Queryable } from "@/lib/db/client";

/** A row from the `extracted_fields` table. */
export interface ExtractedFieldRow {
  id: string;
  case_id: string;
  field_name: string;
  field_value: string | null;
  confidence: number | null;
  created_at: string;
}

/** Fields accepted when inserting one extracted field. */
export interface InsertExtractedFieldInput {
  id: string;
  caseId: string;
  fieldName: string;
  fieldValue?: string | null;
  confidence?: number | null;
}

/** A single extracted field within a bulk insert (case_id supplied separately). */
export interface ExtractedFieldValue {
  id: string;
  fieldName: string;
  fieldValue?: string | null;
  confidence?: number | null;
}

/**
 * Repository for the `extracted_fields` aggregate: per-field extraction output
 * from a case's documents.
 *
 * Every function takes a `Queryable` first arg so it composes inside a
 * `transaction()` owned by a service-command module (plan: "Transaction
 * ownership"). These functions never open transactions themselves.
 */

export async function insertExtractedField(
  db: Queryable,
  field: InsertExtractedFieldInput
): Promise<ExtractedFieldRow> {
  const res = await db.query<ExtractedFieldRow>(
    `insert into extracted_fields
       (id, case_id, field_name, field_value, confidence)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [
      field.id,
      field.caseId,
      field.fieldName,
      field.fieldValue ?? null,
      field.confidence ?? null,
    ]
  );
  return res.rows[0];
}

/**
 * Bulk-insert all extracted fields for one case in a single statement. Returns
 * the inserted rows. An empty `fields` array is a no-op (returns []).
 */
export async function insertExtractedFields(
  db: Queryable,
  caseId: string,
  fields: readonly ExtractedFieldValue[]
): Promise<ExtractedFieldRow[]> {
  if (fields.length === 0) return [];

  const params: unknown[] = [];
  const tuples = fields.map((f, i) => {
    const base = i * 5;
    params.push(
      f.id,
      caseId,
      f.fieldName,
      f.fieldValue ?? null,
      f.confidence ?? null
    );
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  const res = await db.query<ExtractedFieldRow>(
    `insert into extracted_fields
       (id, case_id, field_name, field_value, confidence)
     values ${tuples.join(", ")}
     returning *`,
    params
  );
  return res.rows;
}

/** List a case's extracted fields, oldest first. */
export async function listExtractedFields(
  db: Queryable,
  caseId: string
): Promise<ExtractedFieldRow[]> {
  const res = await db.query<ExtractedFieldRow>(
    `select * from extracted_fields
      where case_id = $1
      order by created_at asc`,
    [caseId]
  );
  return res.rows;
}
