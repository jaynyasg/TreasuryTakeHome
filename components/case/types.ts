import type { CaseDetailDTO, CaseFieldDTO } from "@/lib/server/dto";

/**
 * View-layer types for the reviewer Case Detail screen (Stage 7 / T7, Wave 2).
 *
 * Wave 1 shipped `CaseDetailDTO` carrying only case identity + machine status.
 * The decision-first IA also needs the machine match %, field comparison,
 * warning evidence, processing/audit timeline, source files, and disposition
 * history. Until the query layer (`lib/server/queries.ts` / `lib/server/dto.ts`)
 * is extended to return those, the page composes a `CaseDetailView` from the DTO
 * it has plus OPTIONAL evidence slices — every evidence component renders a
 * graceful "not captured / not yet wired" state when its slice is absent.
 *
 * These are pure presentation types: no I/O, no React, no Next imports. They
 * mirror the existing public verdict vocabulary (`lib/contract.ts`
 * `VerdictStatus`, `FieldVerdict`) so Case Detail speaks the same language as
 * `components/ResultPanel.tsx`.
 */

/** The seven dispositions the case can carry, plus the routing-only state. */
export type DispositionActionKind = "approve" | "reject" | "request_better_image";

/** Input the disposition server action accepts (shared so the client controls
 *  and the route's `actions.ts` agree on the shape without a circular import on
 *  the route-group module path). */
export interface DispositionInput {
  caseId: string;
  action: DispositionActionKind;
  /** Required for reject / request_better_image (and approve-over-concern). */
  reason?: string | null;
  /** Reason category for request_better_image. */
  category?: string | null;
  /** Affected file ids for request_better_image. */
  affectedFileIds?: string[];
}

/** Result the disposition server action returns. */
export interface DispositionResult {
  ok: boolean;
  /** Present on failure: a plain-language message safe to show the reviewer. */
  error?: string;
  /** Echo of the recorded action on success. */
  recorded?: {
    action: DispositionActionKind;
    actorUserId: string;
    at: string;
    reason: string | null;
  };
}

/** The server-action signature the page injects into the client controls. */
export type RecordDispositionAction = (
  input: DispositionInput
) => Promise<DispositionResult>;

/** Per-field comparison status as surfaced in Case Detail. Superset of the
 *  public `VerdictStatus`, kept as a string union so an extended query layer can
 *  pass any of these without a contract change. */
export type FieldComparisonStatus =
  | "match"
  | "close_match"
  | "mismatch"
  | "missing"
  | "missing_on_label"
  | "needs_review"
  | "not_applicable";

/** A normalized field comparison row (from `CaseFieldDTO` once the query
 *  populates it). Identical shape, re-exported for component ergonomics. */
export type FieldComparison = CaseFieldDTO;

/** Warning (GOVERNMENT WARNING) evidence slice — mirrors `warning_evidence`
 *  rows (`lib/db/repositories/warningEvidence.ts`) but view-safe (a file id the
 *  `/api/files/{id}` route can serve, never a raw object key). */
export interface WarningEvidenceView {
  /** File id for the warning crop image, served via `/api/files/{id}`. Null =
   *  no crop captured for this case. */
  cropFileId: string | null;
  /** True when the all-caps "GOVERNMENT WARNING:" lead-in was detected. */
  leadInDetected: boolean | null;
  /** 0..1 confidence the body/lead-in boldness met the typography rule. */
  boldnessConfidence: number | null;
  /** Plain-language reason the machine was uncertain (drives needs-review). */
  uncertaintyReason: string | null;
  /** match | mismatch | needs_review for the warning check overall. */
  verdict: string | null;
}

/** One entry on the chronological Evidence Timeline. */
export interface TimelineEntryView {
  /** Stable id for React keys. */
  id: string;
  /** ISO-8601 timestamp. */
  at: string;
  /** Coarse kind, drives the leading marker + accessible label. */
  kind:
    | "attempt"
    | "state_change"
    | "disposition"
    | "export"
    | "file"
    | "audit";
  /** Short machine action code (e.g. "disposition.reject", "case.scoring"). */
  action: string;
  /** Human-readable one-line description. */
  summary: string;
  /** Actor user id, when the event was performed by a person. */
  actorUserId?: string | null;
  /** Reason note attached to the event, when present. */
  reason?: string | null;
}

/** A source file attached to the case (application PDF / label image / crop). */
export interface SourceFileView {
  id: string;
  /** "application" | "label" | "crop" | other — drives the icon. */
  role: string;
  /** Display name / original filename. */
  name: string | null;
}

/** The most-recent recorded disposition, surfaced after save + in the header. */
export interface RecordedDispositionView {
  action: DispositionActionKind;
  actorUserId: string;
  /** ISO-8601. */
  at: string;
  reason: string | null;
  /** True when this case is included in the audit export snapshot. */
  includedInExport: boolean;
}

/**
 * The complete decision-first view model the Case Detail page renders. `dto` is
 * always present (Wave 1). Everything else is optional evidence the query layer
 * will supply later; components degrade gracefully when a slice is `undefined`.
 */
export interface CaseDetailView {
  dto: CaseDetailDTO;
  /** Machine overall verdict label + match %, when a verdict exists. */
  machine?: {
    overall: "all_match" | "needs_review" | "has_mismatches" | null;
    matchPercentage: number | null;
    summary: string | null;
  };
  fields?: FieldComparison[];
  warning?: WarningEvidenceView;
  timeline?: TimelineEntryView[];
  sourceFiles?: SourceFileView[];
  disposition?: RecordedDispositionView | null;
  /** True when an external party (admin) changed the case since this view
   *  loaded — final actions disable until refresh. */
  stale?: boolean;
  /** Who last changed the case, shown in the stale banner. */
  staleChangedBy?: string | null;
}
