import type { CaseState } from "@/lib/core/state/case";
import type {
  CaseDetailView,
  DispositionActionKind,
  FieldComparison,
} from "./types";

/**
 * Pure decision logic for the Case Detail disposition controls (Stage 7 / T7,
 * Wave 2 — plan "Disposition Interaction Rules"). No I/O, no React, no Next
 * imports, so it is unit-testable in isolation and reused by both the client
 * controls and any server-side pre-check.
 *
 * The machine verdict is ADVISORY; these rules gate the AUTHORITATIVE human
 * disposition. They never *perform* a transition (that is `recordDisposition`'s
 * job, which re-enforces reason rules + the state machine + audit atomically) —
 * they only decide what the reviewer may attempt and what the UI must require.
 */

/** Statuses that represent an unresolved red/amber machine concern. Overriding
 *  any of these on an Approve requires a written note. */
const CONCERN_STATUSES: ReadonlySet<string> = new Set([
  "mismatch",
  "missing",
  "missing_on_label",
  "needs_review",
]);

/** Case states in which a final human disposition has already been recorded or
 *  the case is otherwise closed to new dispositions. */
const ALREADY_DISPOSITIONED: ReadonlySet<CaseState> = new Set([
  "disposition_recorded",
  "archived",
  "purged",
]);

/** Whether a given action must carry a reason (mirrors the server's
 *  REASON_REQUIRED set in `recordDisposition.ts`, kept in lockstep). */
export function reasonRequired(
  action: DispositionActionKind,
  view: CaseDetailView
): boolean {
  if (action === "reject" || action === "request_better_image") return true;
  // Approve: optional for a clean green case, REQUIRED when overriding a concern.
  if (action === "approve") return hasOverridableConcern(view);
  return false;
}

/** True when the field comparison or machine verdict carries an unresolved
 *  red/amber concern that an Approve would override. */
export function hasOverridableConcern(view: CaseDetailView): boolean {
  if (view.machine?.overall === "has_mismatches") return true;
  if (view.machine?.overall === "needs_review") return true;
  const fields: FieldComparison[] = view.fields ?? [];
  return fields.some((f) => CONCERN_STATUSES.has(f.status));
}

/** Reason a given action is disabled, or null when it is enabled. */
export interface ActionGate {
  enabled: boolean;
  /** Why it is disabled (shown as helper text / title), or null when enabled. */
  disabledReason: string | null;
  /** True when the action, though enabled, requires a reason before submit. */
  requiresReason: boolean;
}

/**
 * Gate each disposition action for the current view (plan rules):
 *  - Approve: enabled only when evidence has loaded AND assignment is current
 *    (not stale, not already dispositioned). Reason required iff overriding a
 *    concern.
 *  - Reject: enabled when assignment is current; ALWAYS requires a reason.
 *  - Request better image: enabled when assignment is current; ALWAYS requires
 *    a reason (category + optional text + affected files).
 *
 * needs_review is a routing state, not a final disposition — it never disables
 * the human actions; the reviewer resolves it *through* one of them.
 */
export function gateAction(
  action: DispositionActionKind,
  view: CaseDetailView,
  opts: { evidenceLoaded: boolean }
): ActionGate {
  const requiresReason = reasonRequired(action, view);

  // Already-dispositioned / archived: no further final action until refresh.
  if (ALREADY_DISPOSITIONED.has(view.dto.status) || view.disposition) {
    return {
      enabled: false,
      disabledReason: "A disposition is already recorded. Refresh to continue.",
      requiresReason,
    };
  }

  // Stale view: an external change landed; disable until the reviewer reloads.
  if (view.stale) {
    const who = view.staleChangedBy ? ` by ${view.staleChangedBy}` : "";
    return {
      enabled: false,
      disabledReason: `This case changed${who} since you loaded it. Refresh to see who changed it.`,
      requiresReason,
    };
  }

  // Approve has the strictest precondition: evidence must be loaded.
  if (action === "approve" && !opts.evidenceLoaded) {
    return {
      enabled: false,
      disabledReason: "Approve unlocks once the case evidence has loaded.",
      requiresReason,
    };
  }

  return { enabled: true, disabledReason: null, requiresReason };
}

/** Validate a submission against the reason rules. Returns an error message, or
 *  null when the submission may proceed. Mirrors `MissingReasonError`. */
export function validateSubmission(
  action: DispositionActionKind,
  view: CaseDetailView,
  input: { reason: string | null; category?: string | null }
): string | null {
  const reason = input.reason?.trim() ? input.reason.trim() : null;

  if (action === "request_better_image" && !input.category?.trim()) {
    return "Select a reason category for the better-image request.";
  }
  if (reasonRequired(action, view) && !reason) {
    if (action === "approve") {
      return "A note is required to approve over an unresolved machine concern.";
    }
    return action === "reject"
      ? "A reason is required to reject this case."
      : "A reason is required to request a better image.";
  }
  return null;
}
