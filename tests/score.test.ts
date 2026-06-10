import { describe, expect, it } from "vitest";
import { buildMatchReport } from "@/lib/engine/score";
import {
  ColaApplication,
  ExtractedLabel,
  GOVERNMENT_WARNING_BODY,
  GOVERNMENT_WARNING_HEADING,
} from "@/lib/contract";

const application: ColaApplication = {
  serialNumber: "100002",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 MILLILITERS",
  applicantNameAddress: "OLD TOM DISTILLERY, 100 MAIN ST, LOUISVILLE KY 40202",
};

const cleanLabel: ExtractedLabel = {
  brandName: "OLD TOM DISTILLERY",
  fancifulName: null,
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  producerNameAddress: "Old Tom Distillery, Louisville, KY",
  countryOfOrigin: null,
  wineAppellation: null,
  wineVintage: null,
  governmentWarning: {
    present: true,
    text: `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY}`,
    headingStyle: "all_caps",
  },
  readability: "clear",
};

describe("match report scoring (C3)", () => {
  it("scores a fully matching pair at 100% with overall all_match", () => {
    const report = buildMatchReport(application, cleanLabel);
    expect(report.matchPercentage).toBe(100);
    expect(report.overall).toBe("all_match");
    expect(report.verdicts.every((v) => ["match", "close_match", "not_applicable"].includes(v.status))).toBe(true);
  });

  it("excludes wine-only fields for spirits from the denominator", () => {
    const report = buildMatchReport(application, cleanLabel);
    const appellation = report.verdicts.find((v) => v.field === "wineAppellation");
    expect(appellation?.status).toBe("not_applicable");
  });

  it("drops below 100% and explains when ABV differs", () => {
    const report = buildMatchReport(application, {
      ...cleanLabel,
      alcoholContent: "40% Alc./Vol. (80 Proof)",
    });
    expect(report.matchPercentage).toBeLessThan(100);
    expect(report.overall).toBe("has_mismatches");
    const abv = report.verdicts.find((v) => v.field === "alcoholContent");
    expect(abv?.status).toBe("mismatch");
    expect(abv?.reason).toMatch(/45|40/);
  });

  it("flags a missing government warning", () => {
    const report = buildMatchReport(application, {
      ...cleanLabel,
      governmentWarning: { present: false, text: null, headingStyle: null },
    });
    const gw = report.verdicts.find((v) => v.field === "governmentWarning");
    expect(gw?.status).toBe("missing_on_label");
    expect(report.overall).toBe("has_mismatches");
  });

  it("returns needs_review (not mismatch) when the label was unreadable", () => {
    const report = buildMatchReport(application, {
      ...cleanLabel,
      brandName: null,
      readability: "partial",
    });
    const brand = report.verdicts.find((v) => v.field === "brandName");
    expect(brand?.status).toBe("needs_review");
    expect(report.overall).toBe("needs_review");
  });

  it("treats case-only brand difference as a close match, not a mismatch", () => {
    const report = buildMatchReport(application, {
      ...cleanLabel,
      brandName: "Old Tom Distillery",
    });
    const brand = report.verdicts.find((v) => v.field === "brandName");
    expect(brand?.status).toBe("close_match");
    expect(report.overall).toBe("all_match");
    expect(report.matchPercentage).toBe(100);
  });

  it("requires country of origin for imports", () => {
    const imported: ColaApplication = {
      ...application,
      sourceOfProduct: "imported",
      countryOfOrigin: "PRODUCT OF FRANCE",
    };
    const report = buildMatchReport(imported, cleanLabel); // label has no origin
    const origin = report.verdicts.find((v) => v.field === "countryOfOrigin");
    expect(origin?.status).toBe("missing_on_label");
  });
});
