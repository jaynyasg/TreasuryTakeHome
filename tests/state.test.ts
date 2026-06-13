import { describe, expect, it } from "vitest";
import {
  BATCH_STATES,
  BATCH_TRANSITIONS,
  assertBatchTransition,
  canBatchTransition,
  isTerminalBatchState,
  type BatchState,
} from "@/lib/core/state/batch";
import {
  CASE_STATES,
  CASE_TRANSITIONS,
  assertCaseTransition,
  canCaseTransition,
  isTerminalCaseState,
  type CaseState,
} from "@/lib/core/state/case";
import { nextStates } from "@/lib/core/state/transition";

describe("batch lifecycle state machine (E1)", () => {
  it("has a transition entry for every declared state", () => {
    for (const s of BATCH_STATES) {
      expect(BATCH_TRANSITIONS[s as BatchState]).toBeDefined();
    }
    // and no transition map keys outside the declared states
    expect(Object.keys(BATCH_TRANSITIONS).sort()).toEqual([...BATCH_STATES].sort());
  });

  it("only lists transitions to declared states", () => {
    const known = new Set<string>(BATCH_STATES);
    for (const s of BATCH_STATES) {
      for (const to of BATCH_TRANSITIONS[s as BatchState]) {
        expect(known.has(to)).toBe(true);
      }
    }
  });

  it("allows representative valid transitions", () => {
    const valid: Array<[BatchState, BatchState]> = [
      ["draft", "preflighting"],
      ["preflighting", "ready_to_process"],
      ["preflighting", "draft"],
      ["ready_to_process", "processing"],
      ["processing", "partially_failed"],
      ["processing", "ready_for_review"],
      ["partially_failed", "processing"],
      ["ready_for_review", "review_in_progress"],
      ["review_in_progress", "exported"],
      ["exported", "archived"],
      ["archived", "purge_eligible"],
      ["purge_eligible", "purged"],
      ["purge_eligible", "archived"],
    ];
    for (const [from, to] of valid) {
      expect(canBatchTransition(from, to)).toBe(true);
    }
  });

  it("rejects representative invalid transitions", () => {
    const invalid: Array<[BatchState, BatchState]> = [
      ["draft", "processing"],
      ["draft", "purged"],
      ["ready_to_process", "exported"],
      ["processing", "draft"],
      ["exported", "draft"],
      ["purged", "archived"],
      ["archived", "purged"],
    ];
    for (const [from, to] of invalid) {
      expect(canBatchTransition(from, to)).toBe(false);
    }
  });

  it("assertBatchTransition throws on invalid and passes on valid", () => {
    expect(() => assertBatchTransition("draft", "processing")).toThrow(
      /Invalid batch transition: draft -> processing/
    );
    expect(() => assertBatchTransition("draft", "preflighting")).not.toThrow();
  });

  it("terminal state purged has no outgoing transitions", () => {
    expect(nextStates(BATCH_TRANSITIONS, "purged")).toEqual([]);
    expect(isTerminalBatchState("purged")).toBe(true);
    expect(isTerminalBatchState("archived")).toBe(false);
    expect(isTerminalBatchState("draft")).toBe(false);
  });
});

describe("case lifecycle state machine (E1)", () => {
  it("has a transition entry for every declared state", () => {
    for (const s of CASE_STATES) {
      expect(CASE_TRANSITIONS[s as CaseState]).toBeDefined();
    }
    expect(Object.keys(CASE_TRANSITIONS).sort()).toEqual([...CASE_STATES].sort());
  });

  it("only lists transitions to declared states", () => {
    const known = new Set<string>(CASE_STATES);
    for (const s of CASE_STATES) {
      for (const to of CASE_TRANSITIONS[s as CaseState]) {
        expect(known.has(to)).toBe(true);
      }
    }
  });

  it("allows representative valid transitions", () => {
    const valid: Array<[CaseState, CaseState]> = [
      ["draft", "queued"],
      ["queued", "extracting"],
      ["queued", "retry_wait"],
      ["queued", "dead_letter"],
      ["extracting", "scoring"],
      ["extracting", "failed"],
      ["scoring", "needs_review"],
      ["scoring", "has_mismatches"],
      ["scoring", "clean_match"],
      ["retry_wait", "queued"],
      ["retry_wait", "scoring"],
      ["dead_letter", "queued"],
      ["needs_review", "disposition_recorded"],
      ["needs_review", "needs_better_image"],
      ["has_mismatches", "disposition_recorded"],
      ["clean_match", "disposition_recorded"],
      ["needs_better_image", "queued"],
      ["failed", "queued"],
      ["disposition_recorded", "archived"],
      ["archived", "purged"],
    ];
    for (const [from, to] of valid) {
      expect(canCaseTransition(from, to)).toBe(true);
    }
  });

  it("rejects representative invalid transitions", () => {
    const invalid: Array<[CaseState, CaseState]> = [
      ["draft", "scoring"],
      ["draft", "purged"],
      ["queued", "scoring"],
      ["scoring", "archived"],
      ["clean_match", "extracting"],
      ["disposition_recorded", "purged"],
      ["archived", "queued"],
      ["purged", "archived"],
    ];
    for (const [from, to] of invalid) {
      expect(canCaseTransition(from, to)).toBe(false);
    }
  });

  it("assertCaseTransition throws on invalid and passes on valid", () => {
    expect(() => assertCaseTransition("draft", "scoring")).toThrow(
      /Invalid case transition: draft -> scoring/
    );
    expect(() => assertCaseTransition("draft", "queued")).not.toThrow();
  });

  it("terminal state purged has no outgoing transitions", () => {
    expect(nextStates(CASE_TRANSITIONS, "purged")).toEqual([]);
    expect(isTerminalCaseState("purged")).toBe(true);
    expect(isTerminalCaseState("archived")).toBe(false);
    expect(isTerminalCaseState("draft")).toBe(false);
  });
});
