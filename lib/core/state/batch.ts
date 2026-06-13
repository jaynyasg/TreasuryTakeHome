import {
  assertTransition,
  canTransition,
  type TransitionMap,
} from "./transition";

/**
 * Batch lifecycle: a batch of label-verification cases moves from upload
 * through preflight, processing, review, export, and eventual purge.
 *
 * Worker-safe: pure data + pure functions, no I/O, no framework imports.
 */
export const BATCH_STATES = [
  "draft",
  "preflighting",
  "ready_to_process",
  "processing",
  "partially_failed",
  "ready_for_review",
  "review_in_progress",
  "exported",
  "archived",
  "purge_eligible",
  "purged",
] as const;
export type BatchState = (typeof BATCH_STATES)[number];

export const BATCH_TRANSITIONS: TransitionMap<BatchState> = {
  draft: ["preflighting"],
  preflighting: ["ready_to_process", "draft"],
  ready_to_process: ["processing"],
  processing: ["partially_failed", "ready_for_review"],
  partially_failed: ["processing", "ready_for_review"],
  ready_for_review: ["review_in_progress"],
  review_in_progress: ["exported", "ready_for_review"],
  exported: ["archived", "review_in_progress"],
  archived: ["purge_eligible"],
  purge_eligible: ["purged", "archived"],
  purged: [],
};

/** True when `from -> to` is a permitted batch transition. */
export function canBatchTransition(from: BatchState, to: BatchState): boolean {
  return canTransition(BATCH_TRANSITIONS, from, to);
}

/** Throws on an invalid batch transition; otherwise returns. */
export function assertBatchTransition(from: BatchState, to: BatchState): void {
  assertTransition(BATCH_TRANSITIONS, from, to, "batch");
}

/** A batch in a terminal state has no further transitions. */
export function isTerminalBatchState(state: BatchState): boolean {
  return state === "purged";
}
