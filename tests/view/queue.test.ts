import { describe, expect, it } from "vitest";
import {
  severityRank,
  statusPriority,
  orderQueueRows,
  computeCounts,
  summarizeIssue,
  statusLabel,
  severityLabel,
} from "@/lib/view/queue";
import type { QueueRowDTO, QueueSeverity } from "@/lib/server/dto";
import type { CaseState } from "@/lib/core/state/case";

/** Build a QueueRowDTO with sensible defaults overridable per test. */
function row(over: Partial<QueueRowDTO> & { caseId: string }): QueueRowDTO {
  return {
    caseId: over.caseId,
    batchId: over.batchId ?? "b1",
    batchName: over.batchName ?? "Batch 1",
    severity: over.severity ?? "none",
    status: over.status ?? "queued",
    brand: over.brand ?? null,
    classType: over.classType ?? null,
    applicant: over.applicant ?? null,
    issueSummary: over.issueSummary ?? "",
    issueFull: over.issueFull ?? "",
    assignedUserId: over.assignedUserId ?? null,
    assignedToMe: over.assignedToMe ?? false,
    updatedAt: over.updatedAt ?? "2026-06-13T00:00:00.000Z",
  };
}

describe("severityRank", () => {
  it("orders red < amber < green < none", () => {
    expect(severityRank("red")).toBeLessThan(severityRank("amber"));
    expect(severityRank("amber")).toBeLessThan(severityRank("green"));
    expect(severityRank("green")).toBeLessThan(severityRank("none"));
  });

  it("assigns the documented numeric buckets", () => {
    const ranks: Record<QueueSeverity, number> = {
      red: 0,
      amber: 1,
      green: 2,
      none: 3,
    };
    for (const [sev, want] of Object.entries(ranks)) {
      expect(severityRank(sev as QueueSeverity)).toBe(want);
    }
  });
});

describe("statusPriority", () => {
  it("ranks failed/needs-action ahead of settled states", () => {
    expect(statusPriority("failed")).toBeLessThan(statusPriority("needs_review"));
    expect(statusPriority("needs_review")).toBeLessThan(
      statusPriority("has_mismatches")
    );
    expect(statusPriority("has_mismatches")).toBeLessThan(
      statusPriority("clean_match")
    );
    expect(statusPriority("clean_match")).toBeLessThan(statusPriority("archived"));
  });

  it("falls back to a mid priority for unmapped-ish states without throwing", () => {
    // Every declared CaseState should yield a finite number.
    const states: CaseState[] = [
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
    ];
    for (const s of states) {
      expect(Number.isFinite(statusPriority(s))).toBe(true);
    }
  });
});

describe("orderQueueRows", () => {
  it("orders by severity bucket first", () => {
    const out = orderQueueRows([
      row({ caseId: "c-green", severity: "green" }),
      row({ caseId: "c-red", severity: "red" }),
      row({ caseId: "c-amber", severity: "amber" }),
      row({ caseId: "c-none", severity: "none" }),
    ]);
    expect(out.map((r) => r.caseId)).toEqual([
      "c-red",
      "c-amber",
      "c-green",
      "c-none",
    ]);
  });

  it("orders by status priority within the same severity", () => {
    const out = orderQueueRows([
      row({ caseId: "clean", severity: "red", status: "clean_match" }),
      row({ caseId: "fail", severity: "red", status: "failed" }),
      row({ caseId: "review", severity: "red", status: "needs_review" }),
    ]);
    expect(out.map((r) => r.caseId)).toEqual(["fail", "review", "clean"]);
  });

  it("orders by updatedAt DESC within the same severity+status", () => {
    const out = orderQueueRows([
      row({
        caseId: "older",
        severity: "amber",
        status: "needs_review",
        updatedAt: "2026-06-10T00:00:00.000Z",
      }),
      row({
        caseId: "newer",
        severity: "amber",
        status: "needs_review",
        updatedAt: "2026-06-12T00:00:00.000Z",
      }),
    ]);
    expect(out.map((r) => r.caseId)).toEqual(["newer", "older"]);
  });

  it("breaks ties deterministically by caseId ASC", () => {
    const ts = "2026-06-13T00:00:00.000Z";
    const out = orderQueueRows([
      row({ caseId: "c-b", severity: "green", status: "clean_match", updatedAt: ts }),
      row({ caseId: "c-a", severity: "green", status: "clean_match", updatedAt: ts }),
      row({ caseId: "c-c", severity: "green", status: "clean_match", updatedAt: ts }),
    ]);
    expect(out.map((r) => r.caseId)).toEqual(["c-a", "c-b", "c-c"]);
  });

  it("is stable: re-sorting an already-ordered list is a no-op (no reshuffle)", () => {
    const input = [
      row({ caseId: "c1", severity: "red", status: "failed" }),
      row({ caseId: "c2", severity: "amber", status: "needs_review" }),
      row({ caseId: "c3", severity: "green", status: "clean_match" }),
    ];
    const once = orderQueueRows(input);
    const twice = orderQueueRows(once);
    expect(twice.map((r) => r.caseId)).toEqual(once.map((r) => r.caseId));
  });

  it("does not mutate the input array", () => {
    const input = [
      row({ caseId: "c-green", severity: "green" }),
      row({ caseId: "c-red", severity: "red" }),
    ];
    const before = input.map((r) => r.caseId);
    orderQueueRows(input);
    expect(input.map((r) => r.caseId)).toEqual(before);
  });
});

describe("computeCounts", () => {
  it("tallies severity buckets independently", () => {
    const counts = computeCounts([
      row({ caseId: "1", severity: "red" }),
      row({ caseId: "2", severity: "red" }),
      row({ caseId: "3", severity: "amber" }),
      row({ caseId: "4", severity: "green" }),
      row({ caseId: "5", severity: "none" }),
    ]);
    expect(counts.red).toBe(2);
    expect(counts.amber).toBe(1);
    expect(counts.green).toBe(1);
  });

  it("tallies failed and needsAction by status family", () => {
    const counts = computeCounts([
      row({ caseId: "1", severity: "red", status: "failed" }),
      row({ caseId: "2", severity: "red", status: "dead_letter" }),
      row({ caseId: "3", severity: "amber", status: "needs_review" }),
      row({ caseId: "4", severity: "amber", status: "has_mismatches" }),
      row({ caseId: "5", severity: "amber", status: "needs_better_image" }),
      row({ caseId: "6", severity: "green", status: "clean_match" }),
    ]);
    expect(counts.failed).toBe(2);
    expect(counts.needsAction).toBe(3);
  });

  it("returns all-zero for an empty queue", () => {
    expect(computeCounts([])).toEqual({
      red: 0,
      amber: 0,
      green: 0,
      failed: 0,
      needsAction: 0,
    });
  });
});

describe("summarizeIssue", () => {
  it("returns short text unchanged and not truncated", () => {
    const out = summarizeIssue("Brand name differs", 120);
    expect(out.summary).toBe("Brand name differs");
    expect(out.full).toBe("Brand name differs");
    expect(out.truncated).toBe(false);
  });

  it("collapses internal whitespace/newlines to single spaces", () => {
    const out = summarizeIssue("Brand   name\n\ndiffers   here");
    expect(out.summary).toBe("Brand name differs here");
  });

  it("truncates long text on a word boundary and preserves the full text", () => {
    const long =
      "The brand name on the label does not match the application and the alcohol content appears to differ by several percentage points which requires manual review";
    const out = summarizeIssue(long, 60);
    expect(out.truncated).toBe(true);
    expect(out.summary.endsWith("…")).toBe(true);
    // Truncated display is short; full text is intact for accessible expansion.
    expect(out.summary.length).toBeLessThanOrEqual(60);
    expect(out.full).toBe(long.replace(/\s+/g, " ").trim());
    // No partial word: the visible body (minus ellipsis) is a prefix word-set.
    expect(long.startsWith(out.summary.replace(/…$/, "").trimEnd())).toBe(true);
  });

  it("picks the highest-priority problem verdict from a verdict list", () => {
    const out = summarizeIssue([
      { field: "fancifulName", status: "close_match", reason: "minor case diff" },
      { field: "brandName", status: "mismatch", reason: "Brand differs: ACME vs ACNE" },
      { field: "netContents", status: "missing_on_label", reason: "Net contents absent" },
    ]);
    expect(out.full).toBe("Brand differs: ACME vs ACNE");
  });

  it("returns empty summary when no verdict is a problem (clean match)", () => {
    const out = summarizeIssue([
      { field: "brandName", status: "match", reason: "exact" },
      { field: "classType", status: "not_applicable", reason: "n/a" },
    ]);
    expect(out.summary).toBe("");
    expect(out.truncated).toBe(false);
  });

  it("uses the default maxLen of 120 when not given", () => {
    const text = "x".repeat(200);
    const out = summarizeIssue(text);
    expect(out.summary.length).toBeLessThanOrEqual(120);
    expect(out.full.length).toBe(200);
  });
});

describe("statusLabel", () => {
  it("maps every case state to a human label", () => {
    expect(statusLabel("needs_review")).toBe("Needs review");
    expect(statusLabel("has_mismatches")).toBe("Mismatches");
    expect(statusLabel("clean_match")).toBe("Clean match");
    expect(statusLabel("dead_letter")).toBe("Dead-letter");
    expect(statusLabel("needs_better_image")).toBe("Needs better image");
  });
});

describe("severityLabel", () => {
  it("labels each severity (never color-only)", () => {
    expect(severityLabel("red")).toBe("Red");
    expect(severityLabel("amber")).toBe("Amber");
    expect(severityLabel("green")).toBe("Green");
    expect(severityLabel("none")).toBe("Unscored");
  });
});
