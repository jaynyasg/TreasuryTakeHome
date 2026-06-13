import type { Queryable } from "@/lib/db/client";

/** A row from the `warning_evidence` table (GOVERNMENT WARNING evidence, R7). */
export interface WarningEvidenceRow {
  id: string;
  case_id: string;
  crop_object_key: string | null;
  lead_in_detected: boolean | null;
  boldness_confidence: number | null;
  uncertainty_reason: string | null;
  verdict: string | null;
  created_at: string;
}

/** Fields accepted when recording warning evidence for a case. */
export interface InsertWarningEvidenceInput {
  id: string;
  caseId: string;
  cropObjectKey?: string | null;
  leadInDetected?: boolean | null;
  boldnessConfidence?: number | null;
  uncertaintyReason?: string | null;
  verdict?: string | null;
}

/**
 * Repository for the `warning_evidence` aggregate: per-case evidence about the
 * mandatory GOVERNMENT WARNING (plan/R7 — built later).
 *
 * Every function takes a `Queryable` first arg so it composes inside a
 * `transaction()` owned by a service-command module (plan: "Transaction
 * ownership"). These functions never open transactions themselves.
 */

export async function insertWarningEvidence(
  db: Queryable,
  evidence: InsertWarningEvidenceInput
): Promise<WarningEvidenceRow> {
  const res = await db.query<WarningEvidenceRow>(
    `insert into warning_evidence
       (id, case_id, crop_object_key, lead_in_detected,
        boldness_confidence, uncertainty_reason, verdict)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [
      evidence.id,
      evidence.caseId,
      evidence.cropObjectKey ?? null,
      evidence.leadInDetected ?? null,
      evidence.boldnessConfidence ?? null,
      evidence.uncertaintyReason ?? null,
      evidence.verdict ?? null,
    ]
  );
  return res.rows[0];
}

/** Most recent warning evidence for a case, or null if none recorded. */
export async function getWarningEvidence(
  db: Queryable,
  caseId: string
): Promise<WarningEvidenceRow | null> {
  const res = await db.query<WarningEvidenceRow>(
    `select * from warning_evidence
      where case_id = $1
      order by created_at desc
      limit 1`,
    [caseId]
  );
  return res.rows[0] ?? null;
}

/**
 * List all warning evidence flagged `needs_review` across cases, oldest first —
 * the reviewer work queue for ambiguous GOVERNMENT WARNING checks.
 */
export async function listNeedsReviewWarnings(
  db: Queryable
): Promise<WarningEvidenceRow[]> {
  const res = await db.query<WarningEvidenceRow>(
    `select * from warning_evidence
      where verdict = $1
      order by created_at asc`,
    ["needs_review"]
  );
  return res.rows;
}
