import { createPgPool } from "@/lib/db/pg";
import type { DbClient, Queryable } from "@/lib/db/client";
import { authorizeBatchAccess, type Principal } from "@/lib/auth/authorize";
import { getCase } from "@/lib/db/repositories/cases";
import { getBatch } from "@/lib/db/repositories/batches";
import { getLatestVerdict } from "@/lib/db/repositories/verdicts";
import { getWarningEvidence } from "@/lib/db/repositories/warningEvidence";
import {
  getLatestDisposition,
  listDispositions,
} from "@/lib/db/repositories/dispositions";
import { listAuditEvents } from "@/lib/db/repositories/auditEvents";
import { listAttempts } from "@/lib/db/repositories/processingAttempts";
import { listCaseFiles } from "@/lib/db/repositories/caseFiles";
import {
  verdictPayloadToFields,
  mergeTimeline,
} from "@/lib/server/caseDetailMappers";
import { FieldVerdict } from "@/lib/contract";
import type { CaseState } from "@/lib/core/state/case";
import type { CaseSeverity } from "@/lib/db/repositories/cases";
import { orderQueueRows, computeCounts, summarizeIssue } from "@/lib/view/queue";
import type {
  QueueRowDTO,
  QueueSeverity,
  WorkQueueResult,
  BatchSummaryDTO,
  CaseDetailDTO,
} from "@/lib/server/dto";

/**
 * Reviewer-scoped server data layer (Stage 7 / T7, Wave 1).
 *
 * Reads against the real Postgres database at runtime and returns ONLY the
 * view-safe DTOs in `lib/server/dto.ts` — raw rows never leave this module. Each
 * entry point:
 *   - opens its own pg pool and closes it in a `finally`,
 *   - scopes reviewer reads to assigned batches (admins see everything),
 *   - authorizes single-aggregate reads via `authorizeBatchAccess`,
 *   - throws a typed `NotAuthorizedError` / `NotFoundError` the caller maps to
 *     a 403 / 404 (or `notFound()` / `forbidden` UI).
 *
 * Not exercised by `npm run verify` (no live DB there) — typecheck/lint only.
 */

/** Thrown when the principal may not see the requested aggregate. */
export class NotAuthorizedError extends Error {
  readonly aggregateId: string;
  constructor(aggregateId: string, reason?: string) {
    super(reason ?? `Not authorized to access ${aggregateId}`);
    this.name = "NotAuthorizedError";
    this.aggregateId = aggregateId;
  }
}

/** Thrown when the requested aggregate does not exist. */
export class NotFoundError extends Error {
  readonly aggregateId: string;
  constructor(aggregateId: string) {
    super(`Not found: ${aggregateId}`);
    this.name = "NotFoundError";
    this.aggregateId = aggregateId;
  }
}

/** Options for {@link getWorkQueue}. All optional; sensible defaults apply. */
export interface WorkQueueOptions {
  /** Filter to one severity bucket. */
  severity?: QueueSeverity;
  /** Filter to one case status. */
  status?: CaseState;
  /** 'mine' = only cases on batches assigned to the principal; 'all' = every visible case. */
  assignment?: "mine" | "all";
  /** Opaque pagination cursor returned as `nextCursor` from a prior page. */
  cursor?: string;
  /** Page size (default 50, clamped to 1..200). */
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/** A joined case+batch+assignment row, internal to this module. */
interface JoinedCaseRow {
  case_id: string;
  batch_id: string;
  batch_name: string | null;
  status: CaseState;
  severity: CaseSeverity | null;
  brand: string | null;
  class_type: string | null;
  applicant: string | null;
  assigned_user_id: string | null;
  batch_assigned_user_id: string | null;
  updated_at: string;
}

/**
 * The reviewer's triage Work Queue. Reviewers see only cases whose batch is
 * assigned to them; admins see all. Ordered (in the DB and then re-stabilized in
 * pure code) by severity bucket → status priority → updatedAt → caseId.
 *
 * Cursor pagination is keyed off the case id so live updates don't skip/dupe
 * rows. `counts` tally the whole visible (filtered) set, not just this page.
 */
export async function getWorkQueue(
  principal: Principal,
  opts: WorkQueueOptions = {}
): Promise<WorkQueueResult> {
  const db = createPgPool();
  try {
    const limit = clampLimit(opts.limit);
    const scopeToAssigned =
      principal.role !== "admin" || opts.assignment === "mine";

    const where: string[] = [];
    const params: unknown[] = [];

    if (scopeToAssigned) {
      params.push(principal.userId);
      where.push(`a.user_id = $${params.length}`);
    }
    if (opts.severity && opts.severity !== "none") {
      params.push(opts.severity);
      where.push(`c.severity = $${params.length}`);
    } else if (opts.severity === "none") {
      where.push(`c.severity is null`);
    }
    if (opts.status) {
      params.push(opts.status);
      where.push(`c.status = $${params.length}`);
    }

    const whereSql = where.length ? `where ${where.join(" and ")}` : "";

    // Order in SQL by the same keys the pure helper enforces, so the page window
    // (LIMIT) selects the right rows; orderQueueRows re-stabilizes afterward.
    const rows = await fetchJoinedCases(db, whereSql, params, limit + 1);

    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    const dtos = await Promise.all(
      pageRows.map((r) => toQueueRowDTO(db, r, principal))
    );
    const ordered = orderQueueRows(dtos);

    const result: WorkQueueResult = {
      rows: ordered,
      counts: computeCounts(ordered),
    };
    if (hasMore) {
      result.nextCursor = pageRows[pageRows.length - 1].case_id;
    }
    return result;
  } finally {
    await db.close();
  }
}

/** Batch-level summary header for Batch Detail (Wave 2). */
export async function getBatchSummary(
  principal: Principal,
  batchId: string
): Promise<BatchSummaryDTO> {
  const db = createPgPool();
  try {
    const batch = await getBatch(db, batchId);
    if (!batch) throw new NotFoundError(`batch:${batchId}`);

    const decision = await authorizeBatchAccess(db, principal, batchId, "read");
    if (!decision.allowed) {
      throw new NotAuthorizedError(`batch:${batchId}`, decision.reason);
    }

    const rows = await fetchJoinedCases(
      db,
      "where c.batch_id = $1",
      [batchId],
      // No real upper bound needed for a single batch's counts at demo scale.
      MAX_LIMIT
    );
    const dtos = await Promise.all(
      rows.map((r) => toQueueRowDTO(db, r, principal))
    );

    return {
      batchId: batch.id,
      batchName: batch.name ?? batch.id,
      status: batch.status,
      counts: computeCounts(dtos),
      totalCases: dtos.length,
      assignedToMe:
        principal.role === "admin" ||
        rows.some((r) => r.batch_assigned_user_id === principal.userId),
      updatedAt: batch.updated_at,
    };
  } finally {
    await db.close();
  }
}

/** Decision-first Case Detail payload (Wave 2). */
export async function getCaseDetail(
  principal: Principal,
  caseId: string
): Promise<CaseDetailDTO> {
  const db = createPgPool();
  try {
    const row = await getCase(db, caseId);
    if (!row) throw new NotFoundError(`case:${caseId}`);

    const decision = await authorizeBatchAccess(
      db,
      principal,
      row.batch_id,
      "read"
    );
    if (!decision.allowed) {
      throw new NotAuthorizedError(`case:${caseId}`, decision.reason);
    }

    const batch = await getBatch(db, row.batch_id);

    // Assemble the rich evidence slices within the same pool. Each read is
    // independent of the others, so fetch them concurrently.
    const [verdict, warningRow, files, attempts, dispositions, audits, latestDisposition] =
      await Promise.all([
        getLatestVerdict(db, caseId),
        getWarningEvidence(db, caseId),
        listCaseFiles(db, caseId),
        listAttempts(db, caseId),
        listDispositions(db, caseId),
        listAuditEvents(db, "case", caseId),
        getLatestDisposition(db, caseId),
      ]);

    // machine: latest verdict overall / match % / summary. match_percent comes
    // back from PG numeric as a string — coerce to a finite number or null.
    const machine = verdict
      ? {
          overall: toMachineOverall(verdict.overall),
          matchPercentage: coerceNumber(verdict.match_percent),
          summary: extractSummary(verdict.payload),
        }
      : undefined;

    // fields: parse the verdict payload (untrusted jsonb) into validated rows.
    const fields = verdict ? verdictPayloadToFields(verdict.payload) : undefined;

    // warning: map the warning-evidence row. cropFileId points at the case's
    // LABEL file so the reviewer sees the label image alongside the boldness /
    // lead-in / uncertainty metadata. A dedicated cropped-region endpoint that
    // serves just the warning bounding box is a future enhancement; the
    // substantive evidence here is the boldness/lead-in/uncertainty/verdict
    // metadata, not the crop framing.
    const labelFile = files.find((f) => f.kind === "label") ?? null;
    const warning = warningRow
      ? {
          cropFileId: labelFile?.id ?? null,
          leadInDetected: warningRow.lead_in_detected,
          boldnessConfidence: coerceNumber(warningRow.boldness_confidence),
          uncertaintyReason: warningRow.uncertainty_reason,
          verdict: warningRow.verdict,
        }
      : null;

    // timeline: merge attempts + dispositions + audit events, sorted ascending.
    const timeline = mergeTimeline({
      attempts,
      dispositions,
      audits,
    });

    // sourceFiles: file id + role (kind) + display name (file name unavailable
    // on the manifest row, so fall back to the object-key basename, then id).
    const sourceFiles = files.map((f) => ({
      id: f.id,
      role: f.kind,
      name: basename(f.object_key) ?? f.id,
    }));

    // disposition: the most-recent recorded disposition, if any. includedInExport
    // defaults to false — the audit-export snapshot membership is not derivable
    // from the disposition row alone, so we leave it false until an export-status
    // read is wired (future enhancement).
    const disposition = latestDisposition
      ? {
          action: latestDisposition.action,
          actorUserId: latestDisposition.actor_user_id,
          at: latestDisposition.created_at,
          reason: latestDisposition.reason,
          includedInExport: false,
        }
      : null;

    return {
      caseId: row.id,
      batchId: row.batch_id,
      batchName: batch?.name ?? row.batch_id,
      severity: toQueueSeverity(row.severity),
      status: row.status,
      brand: row.brand,
      classType: row.class_type,
      applicant: row.applicant,
      assignedUserId: row.assigned_user_id,
      assignedToMe: row.assigned_user_id === principal.userId,
      updatedAt: row.updated_at,
      machine,
      fields,
      warning,
      timeline,
      sourceFiles,
      disposition,
      // stale: left undefined — optimistic-concurrency stale detection (an
      // external party changing the case after this view loaded) is a later
      // enhancement; nothing here can determine it yet.
    };
  } finally {
    await db.close();
  }
}

// --- internals ---------------------------------------------------------------

function clampLimit(limit?: number): number {
  if (!limit || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.trunc(limit)));
}

function toQueueSeverity(severity: CaseSeverity | null): QueueSeverity {
  return severity ?? "none";
}

/** Narrow a verdict's free-form `overall` to the view's advisory vocabulary. */
function toMachineOverall(
  overall: string | null
): "all_match" | "needs_review" | "has_mismatches" | null {
  switch (overall) {
    case "all_match":
    case "needs_review":
    case "has_mismatches":
      return overall;
    default:
      return null;
  }
}

/**
 * Coerce a PG numeric (returned as a string) — or an already-numeric value — to
 * a finite number, or null when absent/unparseable. Used for match_percent and
 * the warning boldness confidence.
 */
function coerceNumber(value: number | string | null): number | null {
  if (value === null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Pull the human-readable `summary` from an untrusted verdict payload, if any. */
function extractSummary(payload: unknown): string | null {
  if (isRecord(payload) && typeof payload.summary === "string") {
    return payload.summary;
  }
  return null;
}

/** Basename of an object key (last path segment), or null when absent/empty. */
function basename(objectKey: string | null): string | null {
  if (!objectKey) return null;
  const parts = objectKey.split(/[/\\]/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

/**
 * Fetch cases joined to their batch (for name) and assignment (for scope/owner),
 * ordered by the triage keys. Parameterized — `whereSql`/`params` are built by
 * the caller from a fixed allow-list of columns, never from raw user strings.
 */
async function fetchJoinedCases(
  db: Queryable,
  whereSql: string,
  params: readonly unknown[],
  limit: number
): Promise<JoinedCaseRow[]> {
  const limitParam = params.length + 1;
  const res = await db.query<JoinedCaseRow>(
    `select
        c.id              as case_id,
        c.batch_id        as batch_id,
        b.name            as batch_name,
        c.status          as status,
        c.severity        as severity,
        c.brand           as brand,
        c.class_type      as class_type,
        c.applicant       as applicant,
        c.assigned_user_id as assigned_user_id,
        a.user_id         as batch_assigned_user_id,
        c.updated_at      as updated_at
      from cases c
      join batches b on b.id = c.batch_id
      left join assignments a on a.batch_id = c.batch_id
      ${whereSql}
      order by
        case c.severity
          when 'red'   then 0
          when 'amber' then 1
          when 'green' then 2
          else 3
        end,
        c.updated_at desc,
        c.id asc
      limit $${limitParam}`,
    [...params, limit]
  );
  return res.rows;
}

/**
 * Map a joined row to a view-safe QueueRowDTO, deriving the plain-language issue
 * summary from the case's latest verdict payload (parsed-or-empty at the seam).
 */
async function toQueueRowDTO(
  db: Queryable,
  row: JoinedCaseRow,
  principal: Principal
): Promise<QueueRowDTO> {
  const issue = await deriveIssue(db, row.case_id);
  return {
    caseId: row.case_id,
    batchId: row.batch_id,
    batchName: row.batch_name ?? row.batch_id,
    severity: toQueueSeverity(row.severity),
    status: row.status,
    brand: row.brand,
    classType: row.class_type,
    applicant: row.applicant,
    issueSummary: issue.summary,
    issueFull: issue.full,
    assignedUserId: row.assigned_user_id,
    assignedToMe:
      principal.role === "admin" ||
      row.batch_assigned_user_id === principal.userId,
    updatedAt: row.updated_at,
  };
}

/**
 * Read the latest verdict's field verdicts and summarize the top issue. The
 * verdict payload is untrusted jsonb, so we parse each entry through the zod
 * `FieldVerdict` schema and skip anything malformed — never trust the shape.
 */
async function deriveIssue(
  db: Queryable,
  caseId: string
): Promise<{ summary: string; full: string }> {
  const verdict = await getLatestVerdict(db, caseId);
  if (!verdict) return { summary: "", full: "" };

  const verdicts = extractVerdicts(verdict.payload);
  const out = summarizeIssue(verdicts);
  return { summary: out.summary, full: out.full };
}

/** Parse `payload.verdicts` (or a bare array) into validated FieldVerdicts. */
function extractVerdicts(
  payload: unknown
): Array<{ field: string; status: FieldVerdict["status"]; reason: string }> {
  const raw = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.verdicts)
      ? payload.verdicts
      : [];

  const out: Array<{
    field: string;
    status: FieldVerdict["status"];
    reason: string;
  }> = [];
  for (const entry of raw) {
    const parsed = FieldVerdict.safeParse(entry);
    if (parsed.success) {
      out.push({
        field: parsed.data.field,
        status: parsed.data.status,
        reason: parsed.data.reason,
      });
    }
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// Re-export the client type for callers that thread a pool (none yet in Wave 1).
export type { DbClient };
