import { describe, expect, it } from "vitest";
import {
  countProblems,
  formatBytes,
  formatCost,
  formatDuration,
  groupIssues,
  isProblemEntry,
  kindLabel,
  sortManifest,
} from "@/components/intake/format";
import type { ManifestEntry, PreflightIssue } from "@/lib/intake/types";

function entry(over: Partial<ManifestEntry>): ManifestEntry {
  return {
    fileName: "case001_application.pdf",
    kind: "application",
    caseKey: "case001",
    checksum: "abc",
    size: 1024,
    contentType: "application/pdf",
    status: "uploaded",
    ...over,
  };
}

describe("formatBytes", () => {
  it("formats bytes, KB, and MB with binary units", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
  });
});

describe("formatCost", () => {
  it("always renders two decimals and clamps negatives to zero", () => {
    expect(formatCost(0)).toBe("$0.00");
    expect(formatCost(0.4)).toBe("$0.40");
    expect(formatCost(-1)).toBe("$0.00");
    expect(formatCost(12.5)).toBe("$12.50");
  });
});

describe("formatDuration", () => {
  it("renders plain-language durations", () => {
    expect(formatDuration(0)).toBe("under a minute");
    expect(formatDuration(0.4)).toBe("under a minute");
    expect(formatDuration(1)).toBe("about 1 minute");
    expect(formatDuration(3)).toBe("about 3 minutes");
    expect(formatDuration(60)).toBe("about 1 hr");
    expect(formatDuration(65)).toBe("about 1 hr 5 min");
    expect(formatDuration(125)).toBe("about 2 hrs 5 min");
  });
});

describe("kindLabel", () => {
  it("maps kinds to labels", () => {
    expect(kindLabel("application")).toBe("Application");
    expect(kindLabel("label")).toBe("Label");
    expect(kindLabel("unknown")).toBe("Unknown");
  });
});

describe("isProblemEntry / countProblems", () => {
  it("treats anything but uploaded as a problem", () => {
    expect(isProblemEntry(entry({ status: "uploaded" }))).toBe(false);
    expect(isProblemEntry(entry({ status: "duplicate" }))).toBe(true);
    expect(
      countProblems([
        entry({ status: "uploaded" }),
        entry({ status: "invalid" }),
        entry({ status: "duplicate" }),
      ])
    ).toBe(2);
  });
});

describe("sortManifest", () => {
  it("orders problems first, then by case key and file name; does not mutate", () => {
    const input = [
      entry({ fileName: "z_uploaded.pdf", caseKey: "z", status: "uploaded" }),
      entry({ fileName: "a_dup.pdf", caseKey: "a", status: "duplicate" }),
      entry({ fileName: "b_invalid.txt", caseKey: "b", status: "invalid" }),
    ];
    const sorted = sortManifest(input);
    expect(sorted.map((e) => e.status)).toEqual([
      "invalid",
      "duplicate",
      "uploaded",
    ]);
    // Original array order is preserved (no mutation).
    expect(input[0].status).toBe("uploaded");
  });
});

describe("groupIssues", () => {
  const issues: PreflightIssue[] = [
    { kind: "duplicate", message: "dup" },
    { kind: "missing_pair_member", caseKey: "c1", message: "missing label" },
    { kind: "incomplete_case", caseKey: "c1", message: "won't process" },
    { kind: "unsupported", fileName: "x.txt", message: "bad type" },
    { kind: "missing_pair_member", caseKey: "c2", message: "missing app" },
  ];

  it("groups by kind in reviewer-priority order, dropping empties", () => {
    const groups = groupIssues(issues);
    expect(groups.map((g) => g.kind)).toEqual([
      "missing_pair_member",
      "incomplete_case",
      "unsupported",
      "duplicate",
    ]);
    expect(groups[0].issues).toHaveLength(2);
    expect(groups[0].heading).toMatch(/paired file/i);
    expect(groups[0].guidance.length).toBeGreaterThan(0);
  });

  it("returns no groups for an empty issue list", () => {
    expect(groupIssues([])).toEqual([]);
  });
});
