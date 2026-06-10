import { describe, expect, it } from "vitest";
import { generateCase } from "@/lib/engine/generator";
import { buildMatchReport } from "@/lib/engine/score";
import { ColaApplication, ExtractedLabel } from "@/lib/contract";

describe("mock application/label generator (C4)", () => {
  it("is deterministic for the same seed", () => {
    expect(generateCase(42, { defects: 0 })).toEqual(generateCase(42, { defects: 0 }));
  });

  it("produces schema-valid application and label", () => {
    const c = generateCase(7, { defects: 0 });
    expect(() => ColaApplication.parse(c.application)).not.toThrow();
    expect(() => ExtractedLabel.parse(c.label)).not.toThrow();
  });

  it("a clean pair scores 100% through the real engine", () => {
    const c = generateCase(7, { defects: 0 });
    const report = buildMatchReport(c.application, c.label);
    expect(report.matchPercentage).toBe(100);
    expect(c.injectedDefects).toHaveLength(0);
  });

  it("injected defects are detected by the engine, field for field", () => {
    const c = generateCase(11, { defects: 2 });
    expect(c.injectedDefects.length).toBe(2);
    const report = buildMatchReport(c.application, c.label);
    for (const defect of c.injectedDefects) {
      const verdict = report.verdicts.find((v) => v.field === defect.field);
      expect(verdict, `verdict for ${defect.field}`).toBeDefined();
      expect(
        ["mismatch", "missing_on_label"],
        `${defect.field} should be flagged (${defect.description})`
      ).toContain(verdict!.status);
    }
  });

  it("varies beverage type across seeds", () => {
    const types = new Set(
      Array.from({ length: 12 }, (_, i) => generateCase(i, { defects: 0 }).application.beverageType)
    );
    expect(types.size).toBeGreaterThan(1);
  });
});
