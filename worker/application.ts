/**
 * Worker-side reconstruction of a case's `ColaApplication` from durable storage.
 *
 * Intake (T4, built separately) persists the application's matchable fields as
 * `extracted_fields` rows keyed by `application.<colaKey>` (namespaced so a
 * case's application fields never collide with the label fields the worker later
 * writes as `label.<colaKey>`). This module reads those rows back and parses
 * them through the `ColaApplication` zod contract at the seam — nothing
 * downstream sees an unvalidated shape (project boundary rule: parse-or-fail at
 * every seam).
 *
 * Worker-safe: pure + DB-read only, no next/react.
 */
import { z } from "zod";
import { ColaApplication } from "@/lib/contract";
import type { Queryable } from "@/lib/db/client";
import {
  listExtractedFields,
  type ExtractedFieldValue,
} from "@/lib/db/repositories/extractedFields";

/** Prefix distinguishing application fields from worker-written label fields. */
export const APPLICATION_FIELD_PREFIX = "application.";
/** Prefix the worker uses when persisting the extracted label fields. */
export const LABEL_FIELD_PREFIX = "label.";

/** Raised when a case's stored application fields cannot form a valid
 *  ColaApplication — extraction is impossible, so the worker finalizes failed. */
export class ApplicationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationUnavailableError";
  }
}

/**
 * Build the `ExtractedFieldValue[]` rows that intake (or a test harness) inserts
 * for a case's application. Each ColaApplication key becomes one
 * `application.<key>` field; undefined optional keys are omitted.
 */
export function applicationToFields(
  app: ColaApplication,
  idFor: (key: string) => string
): ExtractedFieldValue[] {
  const out: ExtractedFieldValue[] = [];
  for (const [key, value] of Object.entries(app)) {
    if (value === undefined || value === null) continue;
    out.push({
      id: idFor(key),
      fieldName: `${APPLICATION_FIELD_PREFIX}${key}`,
      fieldValue: String(value),
    });
  }
  return out;
}

/**
 * Read a case's application fields back from `extracted_fields` and parse them
 * into a `ColaApplication`. Throws {@link ApplicationUnavailableError} when no
 * application fields exist or they fail contract validation.
 */
export async function loadApplication(
  db: Queryable,
  caseId: string
): Promise<ColaApplication> {
  const rows = await listExtractedFields(db, caseId);
  const raw: Record<string, string> = {};
  for (const row of rows) {
    if (!row.field_name.startsWith(APPLICATION_FIELD_PREFIX)) continue;
    if (row.field_value === null) continue;
    raw[row.field_name.slice(APPLICATION_FIELD_PREFIX.length)] = row.field_value;
  }

  if (Object.keys(raw).length === 0) {
    throw new ApplicationUnavailableError(
      `case ${caseId} has no stored application fields`
    );
  }

  const parsed = ColaApplication.safeParse(raw);
  if (!parsed.success) {
    throw new ApplicationUnavailableError(
      `case ${caseId} application failed contract validation: ${formatIssue(parsed.error)}`
    );
  }
  return parsed.data;
}

function formatIssue(err: z.ZodError): string {
  const first = err.issues[0];
  return first ? `${first.path.join(".") || "(root)"}: ${first.message}` : "schema mismatch";
}
