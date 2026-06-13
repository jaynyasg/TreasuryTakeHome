import {
  assertTransition,
  canTransition,
  type TransitionMap,
} from "./transition";

/**
 * Case lifecycle: a single application/label pair moves through extraction,
 * scoring, agent review/disposition, and eventual archive + purge. Retry and
 * dead-letter states model transient-failure handling in the worker.
 *
 * Worker-safe: pure data + pure functions, no I/O, no framework imports.
 */
export const CASE_STATES = [
  "draft",
  "queued",
  "extracting",
  "scoring",
  "needs_review",
  "has_mismatches",
  "clean_match",
  "disposition_recorded",
  "archived",
  "purged",
  "retry_wait",
  "dead_letter",
  "failed",
  "needs_better_image",
] as const;
export type CaseState = (typeof CASE_STATES)[number];

export const CASE_TRANSITIONS: TransitionMap<CaseState> = {
  draft: ["queued"],
  queued: ["extracting", "retry_wait", "dead_letter"],
  extracting: ["scoring", "retry_wait", "dead_letter", "failed"],
  scoring: ["needs_review", "has_mismatches", "clean_match", "retry_wait", "dead_letter", "failed"],
  retry_wait: ["queued", "extracting", "scoring", "dead_letter"],
  dead_letter: ["queued", "failed"],
  needs_review: ["disposition_recorded", "needs_better_image", "has_mismatches", "clean_match"],
  has_mismatches: ["disposition_recorded", "needs_review"],
  clean_match: ["disposition_recorded", "needs_review"],
  needs_better_image: ["queued", "disposition_recorded"],
  failed: ["queued"],
  disposition_recorded: ["archived"],
  archived: ["purged"],
  purged: [],
};

/** True when `from -> to` is a permitted case transition. */
export function canCaseTransition(from: CaseState, to: CaseState): boolean {
  return canTransition(CASE_TRANSITIONS, from, to);
}

/** Throws on an invalid case transition; otherwise returns. */
export function assertCaseTransition(from: CaseState, to: CaseState): void {
  assertTransition(CASE_TRANSITIONS, from, to, "case");
}

/** A case in a terminal state has no further transitions. */
export function isTerminalCaseState(state: CaseState): boolean {
  return state === "purged";
}
