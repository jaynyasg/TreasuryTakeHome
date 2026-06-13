import { describe, expect, it } from "vitest";
import { computePreflight } from "@/lib/intake/preflight";
import type { ManifestEntry } from "@/lib/intake/types";

function entry(over: Partial<ManifestEntry>): ManifestEntry {
  return {
    fileName: "f.pdf",
    kind: "unknown",
    caseKey: "k",
    checksum: "sum",
    size: 10,
    contentType: "application/pdf",
    status: "uploaded",
    ...over,
  };
}

const OPTS = { perCaseCostUsd: 0.02, perCaseSeconds: 30, concurrency: 5 };

describe("computePreflight", () => {
  it("summarizes a mixed manifest with cost, time, and issues", () => {
    const entries: ManifestEntry[] = [
      // complete case c1
      entry({ fileName: "c1_app.pdf", kind: "application", caseKey: "c1", checksum: "1" }),
      entry({ fileName: "c1_label.png", kind: "label", caseKey: "c1", checksum: "2" }),
      // incomplete case c2 (label missing)
      entry({ fileName: "c2_app.pdf", kind: "application", caseKey: "c2", checksum: "3" }),
      // duplicate of c1 application
      entry({ fileName: "c1_app_copy.pdf", kind: "application", caseKey: "c1", checksum: "1", status: "duplicate" }),
      // unsupported file
      entry({ fileName: "notes.txt", contentType: "text/plain", caseKey: "notes", checksum: "9", status: "invalid" }),
    ];

    const summary = computePreflight(entries, OPTS);

    expect(summary.totalFiles).toBe(5);
    expect(summary.completeCases).toBe(1);
    // incomplete cases: c2 (missing label) and the "notes" unsupported case key.
    expect(summary.incompleteCases).toBe(2);
    expect(summary.duplicates).toBe(1);
    expect(summary.unsupported).toBe(1);

    // cost = 1 complete * 0.02 ; minutes = ceil(1/5)*30/60 = 0.5
    expect(summary.estimatedCostUsd).toBeCloseTo(0.02, 5);
    expect(summary.estimatedMinutes).toBeCloseTo(0.5, 5);

    const kinds = summary.issues.map((i) => i.kind).sort();
    expect(kinds).toContain("duplicate");
    expect(kinds).toContain("unsupported");
    expect(kinds).toContain("missing_pair_member");
    expect(kinds).toContain("incomplete_case");
  });

  it("estimates cost and time across multiple processing waves", () => {
    // 12 complete cases at concurrency 5 => 3 waves => 3*30/60 = 1.5 min.
    const entries: ManifestEntry[] = [];
    for (let i = 0; i < 12; i++) {
      entries.push(
        entry({ fileName: `case${i}_app.pdf`, kind: "application", caseKey: `case${i}`, checksum: `a${i}` }),
        entry({ fileName: `case${i}_label.png`, kind: "label", caseKey: `case${i}`, checksum: `b${i}` })
      );
    }
    const summary = computePreflight(entries, OPTS);
    expect(summary.completeCases).toBe(12);
    expect(summary.estimatedCostUsd).toBeCloseTo(0.24, 5); // 12 * 0.02
    expect(summary.estimatedMinutes).toBeCloseTo(1.5, 5); // ceil(12/5)=3 waves
  });

  it("is deterministic and zero-cost for an empty manifest", () => {
    const a = computePreflight([], OPTS);
    const b = computePreflight([], OPTS);
    expect(a).toEqual(b);
    expect(a.completeCases).toBe(0);
    expect(a.estimatedCostUsd).toBe(0);
    expect(a.estimatedMinutes).toBe(0);
    expect(a.issues).toEqual([]);
  });

  it("treats non-positive concurrency as 1 (no divide-by-zero)", () => {
    const entries = [
      entry({ kind: "application", caseKey: "c1", checksum: "1" }),
      entry({ kind: "label", caseKey: "c1", checksum: "2" }),
    ];
    const summary = computePreflight(entries, { ...OPTS, concurrency: 0 });
    expect(summary.estimatedMinutes).toBeCloseTo(0.5, 5); // 1 wave * 30 / 60
  });
});
