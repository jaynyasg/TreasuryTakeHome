/**
 * View-safe DTOs for the reviewer/admin app (Stage 7 / T7, Wave 1).
 *
 * These are the ONLY shapes that cross from the server data layer
 * (`lib/server/queries.ts`) into reviewer/admin pages and components. Raw
 * Postgres rows (`CaseRow`, `BatchRow`, `AssignmentRow`) never leave the query
 * module — every read maps to one of these DTOs so the UI cannot accidentally
 * depend on column names, leak owner ids it shouldn't, or render unparsed
 * model output.
 *
 * Wave 2 (Work Queue / Case Detail / Intake) imports from THIS file. Keep the
 * shapes additive and stable. Pure types + small unions only — no I/O, no React,
 * no Next imports — so the pure view helpers in `lib/view/queue.ts` and the
 * server queries can both depend on it.
 */
import type { CaseState } from "@/lib/core/state/case";
import type { BatchState } from "@/lib/core/state/batch";
import type { CaseSeverity } from "@/lib/db/repositories/cases";

/** Severity bucket as surfaced to the UI. `none` = no verdict assigned yet. */
export type QueueSeverity = CaseSeverity | "none";

/**
 * One row of the triage Work Queue. Deliberately lightweight (plan: "Triage
 * rendering" — lightweight rows, stable heights) so a 300-case queue stays fast
 * to scan. Mirrors the Work Queue Row Anatomy: severity/status, identity, issue
 * summary, evidence cue, assignment, updated/version cue, primary action.
 */
export interface QueueRowDTO {
  /** Case id — stable tiebreaker for ordering and the open-case link. */
  caseId: string;
  batchId: string;
  /** Batch display name, falling back to id when unnamed. */
  batchName: string;
  severity: QueueSeverity;
  status: CaseState;
  /** Identity columns; null when extraction has not populated them. */
  brand: string | null;
  classType: string | null;
  applicant: string | null;
  /**
   * Plain-language top issue (mismatch or warning uncertainty), already
   * two-line-truncated for the row. `issueFull` carries the untruncated text for
   * the accessible expanded detail / title attribute.
   */
  issueSummary: string;
  issueFull: string;
  /** Assignment cue. null = unassigned. */
  assignedUserId: string | null;
  /** True when the signed-in principal owns this case's batch assignment. */
  assignedToMe: boolean;
  /** ISO-8601 updated timestamp; drives ordering and the "updated" cue. */
  updatedAt: string;
}

/** Severity/status tallies shown above the queue table (priority counters). */
export interface QueueCounts {
  red: number;
  amber: number;
  green: number;
  /** Cases in a failed/dead-letter family (failed, dead_letter). */
  failed: number;
  /** Cases awaiting a human action (needs_review, has_mismatches, needs_better_image). */
  needsAction: number;
}

/** Result of a Work Queue read. `nextCursor` absent => last page. */
export interface WorkQueueResult {
  rows: QueueRowDTO[];
  counts: QueueCounts;
  nextCursor?: string;
}

/** Batch-level summary header for Batch Detail (Wave 2). */
export interface BatchSummaryDTO {
  batchId: string;
  batchName: string;
  status: BatchState;
  /** Per-severity case tallies within this batch. */
  counts: QueueCounts;
  /** Total cases in the batch. */
  totalCases: number;
  /** True when the principal owns the batch assignment (or is admin). */
  assignedToMe: boolean;
  updatedAt: string;
}

/** A single application-vs-label field comparison row in Case Detail. */
export interface CaseFieldDTO {
  field: string;
  status: string;
  applicationValue: string | null;
  labelValue: string | null;
  reason: string;
}

/**
 * A view-safe entry on the Case Detail evidence timeline. Merges processing
 * attempts, dispositions, and audit events into one chronological shape the page
 * maps 1:1 onto `TimelineEntryView`. Pure presentation — no raw rows, no jsonb
 * summaries; just the fields the timeline component renders.
 */
export interface TimelineEntryDTO {
  /** Stable id for React keys. */
  id: string;
  /** ISO-8601 timestamp the entry is sorted by. */
  at: string;
  /** Coarse source kind. `state_change` is an audit event that changed status. */
  kind: "attempt" | "disposition" | "audit" | "state_change";
  /** Short machine action code (e.g. "scoring.succeeded", "disposition.reject"). */
  action: string;
  /** Human-readable one-line description. */
  summary: string;
  /** Actor user id, when a person performed the event. */
  actorUserId?: string | null;
  /** Reason note attached to the event, when present. */
  reason?: string | null;
}

/** A source file attached to the case, view-safe (file id, not object key). */
export interface SourceFileDTO {
  id: string;
  /** "application" | "label" | other — drives the icon. */
  role: string;
  /** Display name (file name, or object-key basename, or the id). */
  name: string;
}

/**
 * Decision-first Case Detail payload (plan: "Case detail IA"). Wave 1 carried
 * only case identity + machine status; the optional rich slices below mirror
 * `CaseDetailView` (machine verdict, field comparison, warning evidence,
 * timeline, source files, disposition) so the page maps them 1:1. Every rich
 * slice is OPTIONAL and additive — existing Work Queue / Batch Detail consumers
 * are unaffected, and the page degrades gracefully when a slice is absent.
 */
export interface CaseDetailDTO {
  caseId: string;
  batchId: string;
  batchName: string;
  severity: QueueSeverity;
  status: CaseState;
  brand: string | null;
  classType: string | null;
  applicant: string | null;
  assignedUserId: string | null;
  assignedToMe: boolean;
  updatedAt: string;

  // --- optional rich evidence slices (Wave 2) ------------------------------

  /** Machine overall verdict label + match % + summary, when a verdict exists. */
  machine?: {
    overall: "all_match" | "needs_review" | "has_mismatches" | null;
    matchPercentage: number | null;
    summary: string | null;
  };
  /** Per-field application-vs-label comparison rows from the verdict payload. */
  fields?: CaseFieldDTO[];
  /** GOVERNMENT WARNING evidence; null when none captured for the case. */
  warning?: {
    cropFileId: string | null;
    leadInDetected: boolean | null;
    boldnessConfidence: number | null;
    uncertaintyReason: string | null;
    verdict: string | null;
  } | null;
  /** Merged chronological timeline (attempts + dispositions + audit). */
  timeline?: TimelineEntryDTO[];
  /** Source files attached to the case. */
  sourceFiles?: SourceFileDTO[];
  /** Most-recent recorded disposition; null when none recorded. */
  disposition?: {
    action: "approve" | "reject" | "request_better_image";
    actorUserId: string;
    at: string;
    reason: string | null;
    includedInExport: boolean;
  } | null;
}
