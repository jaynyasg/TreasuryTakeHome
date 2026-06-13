import { FieldVerdict, MatchReport } from "@/lib/contract";
import type { CaseFieldDTO, TimelineEntryDTO } from "@/lib/server/dto";

/**
 * Pure mappers for the reviewer Case Detail rich slices (Stage 7 / T7, Wave 2).
 *
 * No I/O, no DB, no SDK — these take already-fetched repository rows (typed as
 * narrow view-safe inputs) and produce the optional `CaseDetailDTO` slices the
 * page maps 1:1 onto `CaseDetailView`. They are the testable nucleus of
 * `getCaseDetail`: the merge/sort and the parse-or-empty payload handling are
 * unit-tested in `tests/view/caseDetail.test.ts` without a live database.
 */

/**
 * Parse a verdict `payload` (untrusted jsonb) into validated field-comparison
 * rows. Parse-or-empty at the seam: we first try the whole `MatchReport`; if
 * that fails we fall back to a bare/`.verdicts` array and validate each entry
 * through `FieldVerdict`, skipping anything malformed. Never trusts the shape.
 */
export function verdictPayloadToFields(payload: unknown): CaseFieldDTO[] {
  const report = MatchReport.safeParse(payload);
  if (report.success) {
    return report.data.verdicts.map(toFieldDTO);
  }

  const raw = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.verdicts)
      ? payload.verdicts
      : [];

  const out: CaseFieldDTO[] = [];
  for (const entry of raw) {
    const parsed = FieldVerdict.safeParse(entry);
    if (parsed.success) out.push(toFieldDTO(parsed.data));
  }
  return out;
}

function toFieldDTO(v: FieldVerdict): CaseFieldDTO {
  return {
    field: v.field,
    status: v.status,
    applicationValue: v.applicationValue,
    labelValue: v.labelValue,
    reason: v.reason,
  };
}

/** Minimal attempt row shape the timeline merge needs (subset of the repo row). */
export interface TimelineAttemptInput {
  id: string;
  stage: string;
  attempt_no: number;
  state: string;
  error_class: string | null;
  created_at: string;
}

/** Minimal disposition row shape the timeline merge needs. */
export interface TimelineDispositionInput {
  id: string;
  actor_user_id: string;
  action: string;
  reason: string | null;
  created_at: string;
}

/** Minimal audit-event row shape the timeline merge needs. */
export interface TimelineAuditInput {
  id: string;
  actor_user_id: string | null;
  action: string;
  reason: string | null;
  created_at: string;
}

/**
 * Merge processing attempts, dispositions, and audit events into one timeline,
 * sorted by timestamp ascending (id as a stable tiebreaker for equal
 * timestamps). Each source maps to a `TimelineEntryDTO` with a readable summary.
 * Audit events whose action looks like a status change are tagged `state_change`
 * so the component can mark them distinctly; all others are `audit`.
 */
export function mergeTimeline(input: {
  attempts: readonly TimelineAttemptInput[];
  dispositions: readonly TimelineDispositionInput[];
  audits: readonly TimelineAuditInput[];
}): TimelineEntryDTO[] {
  const entries: TimelineEntryDTO[] = [];

  for (const a of input.attempts) {
    entries.push({
      id: `attempt:${a.id}`,
      at: a.created_at,
      kind: "attempt",
      action: `${a.stage}.${a.state}`,
      summary: attemptSummary(a),
    });
  }

  for (const d of input.dispositions) {
    entries.push({
      id: `disposition:${d.id}`,
      at: d.created_at,
      kind: "disposition",
      action: `disposition.${d.action}`,
      summary: dispositionSummary(d),
      actorUserId: d.actor_user_id,
      reason: d.reason,
    });
  }

  for (const e of input.audits) {
    const isStateChange = /state|status|transition/i.test(e.action);
    entries.push({
      id: `audit:${e.id}`,
      at: e.created_at,
      kind: isStateChange ? "state_change" : "audit",
      action: e.action,
      summary: auditSummary(e),
      actorUserId: e.actor_user_id,
      reason: e.reason,
    });
  }

  entries.sort((x, y) => {
    if (x.at < y.at) return -1;
    if (x.at > y.at) return 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
  return entries;
}

function attemptSummary(a: TimelineAttemptInput): string {
  const stage = a.stage === "extracting" ? "Extraction" : a.stage === "scoring" ? "Scoring" : a.stage;
  const verb =
    a.state === "succeeded"
      ? "succeeded"
      : a.state === "running"
        ? "started"
        : a.state === "dead_letter"
          ? "dead-lettered"
          : "failed";
  const base = `${stage} attempt ${a.attempt_no} ${verb}`;
  return a.error_class ? `${base} (${a.error_class})` : base;
}

function dispositionSummary(d: TimelineDispositionInput): string {
  switch (d.action) {
    case "approve":
      return "Reviewer approved the case";
    case "reject":
      return "Reviewer rejected the case";
    case "request_better_image":
      return "Reviewer requested a better image";
    default:
      return `Reviewer recorded ${d.action}`;
  }
}

function auditSummary(e: TimelineAuditInput): string {
  return e.action.replace(/[._]/g, " ").trim() || "Audit event";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
