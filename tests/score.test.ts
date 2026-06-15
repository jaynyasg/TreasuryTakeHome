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

describe("2023-edition form support (no ABV/net on application)", () => {
  const app2023: ColaApplication = {
    ...application,
    alcoholContent: undefined,
    netContents: undefined,
  };

  it("verifies presence instead of matching when the application omits ABV/net (2023 form)", () => {
    const report = buildMatchReport(app2023, cleanLabel);
    expect(report.matchPercentage).toBe(100);
    expect(report.overall).toBe("all_match");
    const abv = report.verdicts.find((v) => v.field === "alcoholContent");
    expect(abv?.status).toBe("match");
    expect(abv?.reason).toContain("2023");
    const net = report.verdicts.find((v) => v.field === "netContents");
    expect(net?.status).toBe("match");
  });

  it("flags a label with no net contents even without an application value", () => {
    const report = buildMatchReport(app2023, { ...cleanLabel, netContents: null });
    const net = report.verdicts.find((v) => v.field === "netContents");
    expect(net?.status).toBe("missing_on_label");
  });

  it("flags spirits label missing an alcohol statement (mandatory on label)", () => {
    const report = buildMatchReport(app2023, { ...cleanLabel, alcoholContent: null });
    const abv = report.verdicts.find((v) => v.field === "alcoholContent");
    expect(abv?.status).toBe("missing_on_label");
  });

  it("treats absent ABV as not_applicable for malt beverages (optional federally)", () => {
    const maltApp: ColaApplication = {
      ...app2023,
      beverageType: "malt_beverage",
      classType: "India Pale Ale",
    };
    const report = buildMatchReport(maltApp, {
      ...cleanLabel,
      classType: "India Pale Ale",
      alcoholContent: null,
    });
    const abv = report.verdicts.find((v) => v.field === "alcoholContent");
    expect(abv?.status).toBe("not_applicable");
  });

  it("matches declared grape varietals against the label class/type text", () => {
    const wineApp: ColaApplication = {
      ...app2023,
      beverageType: "wine",
      classType: "Pinot Gris",
      grapeVarietals: "Pinot Gris",
    };
    const wineLabel: ExtractedLabel = { ...cleanLabel, classType: "Pinot Gris" };
    const report = buildMatchReport(wineApp, wineLabel);
    const v = report.verdicts.find((x) => x.field === "grapeVarietals");
    expect(v?.status).toBe("match");

    const wrong = buildMatchReport(
      { ...wineApp, grapeVarietals: "Chardonnay" },
      wineLabel
    );
    const w = wrong.verdicts.find((x) => x.field === "grapeVarietals");
    expect(w?.status).toBe("mismatch");
  });

  it("grapeVarietals is not_applicable when undeclared or non-wine", () => {
    const report = buildMatchReport(application, cleanLabel);
    const v = report.verdicts.find((x) => x.field === "grapeVarietals");
    expect(v?.status).toBe("not_applicable");
  });
});

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

  it("routes suspicious small wine ABV OCR disagreements to review when identity fields all match", () => {
    const wineApp: ColaApplication = {
      ...application,
      beverageType: "wine",
      brandName: "OTIUM CELLARS",
      classType: "Pinot Gris",
      alcoholContent: "12",
      applicantNameAddress: "OTIUM CELLARS, WATERFORD, VIRGINIA",
      wineAppellation: "LOUDOUN COUNTY VIRGINIA",
      wineVintage: "2009",
    };
    const report = buildMatchReport(wineApp, {
      ...cleanLabel,
      brandName: "OTIUM CELLARS",
      classType: "Pinot Gris",
      alcoholContent: "10% ALC./VOL.",
      producerNameAddress: "PRODUCED & BOTTLED BY OTIUM CELLARS, WATERFORD, VIRGINIA",
      wineAppellation: "LOUDOUN COUNTY, VIRGINIA",
      wineVintage: "2009",
    });
    const abv = report.verdicts.find((v) => v.field === "alcoholContent");
    expect(abv?.status).toBe("needs_review");
    expect(abv?.reason.toLowerCase()).toContain("ocr");
    expect(report.overall).toBe("needs_review");
  });

  it("keeps small ABV differences as mismatches when wine identity evidence is incomplete", () => {
    const wineApp: ColaApplication = {
      ...application,
      beverageType: "wine",
      brandName: "8 CHAINS NORTH",
      classType: "Cabernet Sauvignon",
      alcoholContent: "11.5",
      applicantNameAddress: "8 CHAINS NORTH, 354 MARKET ST, PORTLAND OR 97209",
      wineVintage: "2022",
    };
    const report = buildMatchReport(wineApp, {
      ...cleanLabel,
      brandName: "8 CHAINS NORTH",
      classType: "Cabernet Sauvignon",
      alcoholContent: "13% ALC./VOL.",
      producerNameAddress: "8 CHAINS NORTH, PORTLAND, OR",
      wineVintage: "2022",
    });
    const abv = report.verdicts.find((v) => v.field === "alcoholContent");
    expect(abv?.status).toBe("mismatch");
    expect(report.overall).toBe("has_mismatches");
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
