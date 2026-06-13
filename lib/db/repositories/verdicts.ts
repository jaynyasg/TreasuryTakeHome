import type { Queryable } from "@/lib/db/client";

/** A row from the `verdicts` table. `payload` is jsonb, returned parsed. */
export interface VerdictRow {
  id: string;
  case_id: string;
  overall: string | null;
  match_percent: number | null;
  payload: unknown;
  ruleset_version: string | null;
  created_at: string;
}

/** Fields accepted when recording a verdict. */
export interface InsertVerdictInput {
  id: string;
  caseId: string;
  overall?: string | null;
  matchPercent?: number | null;
  payload?: unknown;
  rulesetVersion?: string | null;
}

/**
 * Repository for the `verdicts` aggregate: the scored outcome of a case.
 *
 * Every function takes a `Queryable` first arg so it composes inside a
 * `transaction()` owned by a service-command module (plan: "Transaction
 * ownership"). These functions never open transactions themselves.
 */

export async function insertVerdict(
  db: Queryable,
  verdict: InsertVerdictInput
): Promise<VerdictRow> {
  // Serialize payload to JSON text for the jsonb column. PGlite/pg both accept a
  // JSON string for jsonb and return it parsed back into an object on read.
  const payload =
    verdict.payload === undefined || verdict.payload === null
      ? null
      : JSON.stringify(verdict.payload);

  const res = await db.query<VerdictRow>(
    `insert into verdicts
       (id, case_id, overall, match_percent, payload, ruleset_version)
     values ($1, $2, $3, $4, $5, $6)
     returning *`,
    [
      verdict.id,
      verdict.caseId,
      verdict.overall ?? null,
      verdict.matchPercent ?? null,
      payload,
      verdict.rulesetVersion ?? null,
    ]
  );
  return res.rows[0];
}

/** The most recent verdict for a case, or null if none has been recorded. */
export async function getLatestVerdict(
  db: Queryable,
  caseId: string
): Promise<VerdictRow | null> {
  const res = await db.query<VerdictRow>(
    `select * from verdicts
      where case_id = $1
      order by created_at desc
      limit 1`,
    [caseId]
  );
  return res.rows[0] ?? null;
}

/** List a case's verdicts, oldest first (append-only scoring history). */
export async function listVerdicts(
  db: Queryable,
  caseId: string
): Promise<VerdictRow[]> {
  const res = await db.query<VerdictRow>(
    `select * from verdicts
      where case_id = $1
      order by created_at asc`,
    [caseId]
  );
  return res.rows;
}
