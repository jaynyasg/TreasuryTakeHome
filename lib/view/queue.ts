/**
 * Pure, framework-free view-model helpers for the reviewer Work Queue
 * (Stage 7 / T7, Wave 1).
 *
 * Encodes the Work Queue Row Anatomy + ordering rules from
 * `docs/designs/production-gap-closure.md` ("Triage rendering",
 * "Work Queue Row Anatomy") as deterministic functions with NO I/O, NO React,
 * and NO Next imports. The server query layer shapes DTOs; these helpers decide
 * ordering, tally counts, truncate issue text, and produce display labels. Fully
 * unit-tested (`tests/view/queue.test.ts`) — this is the testable nucleus of
 * Stage 7.
 */
import type { CaseState } from "@/lib/core/state/case";
import type {
  QueueRowDTO,
  QueueCounts,
  QueueSeverity,
} from "@/lib/server/dto";
import type { VerdictStatus } from "@/lib/contract";

/**
 * Severity sort bucket. Lower sorts first: red, amber, green, then "none"
 * (unscored) last — matching the SQL `case severity ... else 3 end` in
 * `listCasesByBatch`. Used as the primary ordering key.
 */
export function severityRank(severity: QueueSeverity): number {
  switch (severity) {
    case "red":
      return 0;
    case "amber":
      return 1;
    case "green":
      return 2;
    default:
      return 3; // "none" / unscored
  }
}

/**
 * Status priority WITHIN a severity bucket. Cases needing human attention or
 * showing failure sort ahead of settled cases, so a reviewer's eye lands on
 * actionable work first. Lower sorts first; unknown states fall to the middle.
 */
const STATUS_PRIORITY: Partial<Record<CaseState, number>> = {
  failed: 0,
  dead_letter: 0,
  needs_better_image: 1,
  needs_review: 2,
  has_mismatches: 3,
  retry_wait: 4,
  extracting: 5,
  scoring: 5,
  queued: 6,
  draft: 6,
  clean_match: 7,
  disposition_recorded: 8,
  archived: 9,
  purged: 10,
};

export function statusPriority(status: CaseState): number {
  return STATUS_PRIORITY[status] ?? 5;
}

/**
 * Stable triage ordering (plan: "Sort by severity bucket, status priority,
 * updated time, case ID"). Keys, in order:
 *   1. severity bucket (red, amber, green, none)
 *   2. status priority (actionable/failed first)
 *   3. updatedAt DESC (most recently touched first)
 *   4. caseId ASC (stable, deterministic tiebreak)
 *
 * Returns a NEW array; the input is not mutated. Equal-key rows preserve a
 * deterministic order via the caseId tiebreak, so live updates never reshuffle
 * the visible viewport for cosmetic reasons.
 */
export function orderQueueRows(rows: readonly QueueRowDTO[]): QueueRowDTO[] {
  return [...rows].sort((a, b) => {
    const bySeverity = severityRank(a.severity) - severityRank(b.severity);
    if (bySeverity !== 0) return bySeverity;

    const byStatus = statusPriority(a.status) - statusPriority(b.status);
    if (byStatus !== 0) return byStatus;

    // Most recently updated first. Compare ISO strings as Date for safety.
    const byUpdated =
      Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    if (!Number.isNaN(byUpdated) && byUpdated !== 0) return byUpdated;

    // Deterministic final tiebreak.
    if (a.caseId < b.caseId) return -1;
    if (a.caseId > b.caseId) return 1;
    return 0;
  });
}

/** Status families used to tally `failed` and `needsAction` counters. */
const FAILED_STATES: ReadonlySet<CaseState> = new Set<CaseState>([
  "failed",
  "dead_letter",
]);
const NEEDS_ACTION_STATES: ReadonlySet<CaseState> = new Set<CaseState>([
  "needs_review",
  "has_mismatches",
  "needs_better_image",
]);

/**
 * Tally the priority counters shown above the queue (red/amber/green by
 * severity; failed + needsAction by status family). A row can contribute to both
 * a severity bucket and a status family — they answer different questions.
 */
export function computeCounts(rows: readonly QueueRowDTO[]): QueueCounts {
  const counts: QueueCounts = {
    red: 0,
    amber: 0,
    green: 0,
    failed: 0,
    needsAction: 0,
  };
  for (const row of rows) {
    if (row.severity === "red") counts.red += 1;
    else if (row.severity === "amber") counts.amber += 1;
    else if (row.severity === "green") counts.green += 1;

    if (FAILED_STATES.has(row.status)) counts.failed += 1;
    if (NEEDS_ACTION_STATES.has(row.status)) counts.needsAction += 1;
  }
  return counts;
}

/** Human label for a severity bucket (severity is never color-only — a11y). */
export function severityLabel(severity: QueueSeverity): string {
  switch (severity) {
    case "red":
      return "Red";
    case "amber":
      return "Amber";
    case "green":
      return "Green";
    default:
      return "Unscored";
  }
}

/** Human label for a case lifecycle state, for the row status column. */
const STATUS_LABELS: Record<CaseState, string> = {
  draft: "Draft",
  queued: "Queued",
  extracting: "Extracting",
  scoring: "Scoring",
  needs_review: "Needs review",
  has_mismatches: "Mismatches",
  clean_match: "Clean match",
  disposition_recorded: "Dispositioned",
  archived: "Archived",
  purged: "Purged",
  retry_wait: "Retrying",
  dead_letter: "Dead-letter",
  failed: "Failed",
  needs_better_image: "Needs better image",
};

export function statusLabel(caseState: CaseState): string {
  return STATUS_LABELS[caseState] ?? caseState;
}

/**
 * Result of summarizing a case's top issue: a two-line-truncated display string
 * plus the full untruncated text (preserved for the accessible expanded detail
 * and the row `title`). The Work Queue Row Anatomy requires long evidence
 * summaries to "truncate to two lines with accessible full text".
 */
export interface IssueSummary {
  /** Truncated to `maxLen` with an ellipsis when shortened. */
  summary: string;
  /** Always the complete text. */
  full: string;
  truncated: boolean;
}

/** Priority of verdict statuses for picking the single "top" issue to surface. */
const VERDICT_ISSUE_PRIORITY: Partial<Record<VerdictStatus, number>> = {
  mismatch: 0,
  missing_on_label: 1,
  needs_review: 2,
  close_match: 3,
};

/** Minimal shape of a verdict we read to summarize (decoupled from contract). */
interface VerdictLike {
  field: string;
  status: VerdictStatus;
  reason: string;
}

/**
 * Produce the row's one-line issue summary from EITHER a list of field verdicts
 * (the worker's match report) OR a pre-built reason string.
 *
 *  - Given verdicts: pick the highest-priority problem verdict (mismatch >
 *    missing > needs_review > close_match) and use its reason. If nothing is
 *    wrong, returns an empty summary (the row's evidence cue will show a
 *    clean-match marker instead).
 *  - Given a string: summarize it as-is.
 *
 * The text is collapsed to a single logical line then truncated to `maxLen`
 * (default 120 — roughly two rows of the queue's dense type) on a word boundary
 * where possible, with the FULL text always preserved in `full`.
 */
export function summarizeIssue(
  input: readonly VerdictLike[] | string,
  maxLen = 120
): IssueSummary {
  const full = typeof input === "string" ? input : pickTopVerdictReason(input);
  const collapsed = full.replace(/\s+/g, " ").trim();

  if (collapsed.length <= maxLen) {
    return { summary: collapsed, full: collapsed, truncated: false };
  }

  // Truncate to maxLen, then back off to the last word boundary so we don't cut
  // a word in half. Reserve one char for the ellipsis.
  const hardSlice = collapsed.slice(0, maxLen - 1);
  const lastSpace = hardSlice.lastIndexOf(" ");
  const body =
    lastSpace > maxLen * 0.6 ? hardSlice.slice(0, lastSpace) : hardSlice;
  return {
    summary: `${body.trimEnd()}…`,
    full: collapsed,
    truncated: true,
  };
}

/** Choose the most important problem reason from a verdict list, or "" if clean. */
function pickTopVerdictReason(verdicts: readonly VerdictLike[]): string {
  let best: VerdictLike | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const v of verdicts) {
    const rank = VERDICT_ISSUE_PRIORITY[v.status];
    if (rank === undefined) continue; // match / not_applicable — not an issue
    if (rank < bestRank) {
      bestRank = rank;
      best = v;
    }
  }
  return best ? best.reason : "";
}
