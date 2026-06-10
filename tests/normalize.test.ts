import { describe, expect, it } from "vitest";
import {
  compareAlcoholContent,
  compareNetContents,
  compareText,
  parseAlcoholContent,
  parseNetContents,
} from "@/lib/engine/normalize";

describe("alcohol content normalization (C2)", () => {
  it("parses spirits-style ABV with proof", () => {
    expect(parseAlcoholContent("45% Alc./Vol. (90 Proof)")).toEqual({
      percent: 45,
      proof: 90,
    });
  });

  it("parses a bare form number as percent", () => {
    expect(parseAlcoholContent("12")).toEqual({ percent: 12, proof: null });
  });

  it("parses 'ALC. 13.5% BY VOL.'", () => {
    expect(parseAlcoholContent("ALC. 13.5% BY VOL.")).toEqual({
      percent: 13.5,
      proof: null,
    });
  });

  it("treats equal percents with different formatting as equivalent", () => {
    expect(compareAlcoholContent("12", "12% ALC./VOL.").equivalent).toBe(true);
    expect(compareAlcoholContent("45% Alc./Vol. (90 Proof)", "45% alc/vol").equivalent).toBe(true);
  });

  it("flags genuinely different percents", () => {
    const c = compareAlcoholContent("12", "13.5% ALC./VOL.");
    expect(c.equivalent).toBe(false);
  });

  it("flags inconsistent proof (proof must be 2x percent)", () => {
    const c = compareAlcoholContent("45% Alc./Vol. (90 Proof)", "45% Alc./Vol. (80 Proof)");
    expect(c.equivalent).toBe(false);
  });
});

describe("net contents normalization (C2)", () => {
  it("parses '750 MILLILITERS' to 750 ml", () => {
    expect(parseNetContents("750 MILLILITERS")).toEqual({ ml: 750 });
  });

  it("treats 750 mL / 750ML / 75 cl as equivalent", () => {
    expect(compareNetContents("750 MILLILITERS", "750 mL").equivalent).toBe(true);
    expect(compareNetContents("750 mL", "750ML").equivalent).toBe(true);
    expect(compareNetContents("750 mL", "75 cl").equivalent).toBe(true);
  });

  it("treats 1 LITER as 1000 ml", () => {
    expect(compareNetContents("1 LITER", "1 L").equivalent).toBe(true);
    expect(compareNetContents("1 LITER", "750 mL").equivalent).toBe(false);
  });
});

describe("producer/address comparison (real-label tolerance)", async () => {
  const { compareProducerAddress } = await import("@/lib/engine/normalize");

  it("ignores 'PRODUCED & BOTTLED BY' boilerplate and expands state abbreviations", () => {
    const c = compareProducerAddress(
      "EIGHT CHAINS NORTH, FURNACE MOUNTAIN VINEYARDS LLC, 38593 DAYMONT LN, WATERFORD VA 20197, OTIUM CELLARS",
      "PRODUCED & BOTTLED BY OTIUM CELLARS, WATERFORD, VIRGINIA"
    );
    expect(c.kind).toBe("close");
  });

  it("still flags a genuinely different producer", () => {
    const c = compareProducerAddress(
      "OLD TOM DISTILLERY, 100 MAIN ST, LOUISVILLE KY 40202",
      "BOTTLED BY SANTA FE SPIRITS, SANTA FE, NEW MEXICO"
    );
    expect(c.kind).toBe("different");
  });
});

describe("text field comparison (C2/R6 fuzzy brand matching)", () => {
  it("exact strings match", () => {
    expect(compareText("OTIUM CELLARS", "OTIUM CELLARS").kind).toBe("exact");
  });

  it("case-only difference is a close match, with explanation (Dave's STONE'S THROW)", () => {
    const c = compareText("Stone's Throw", "STONE'S THROW");
    expect(c.kind).toBe("close");
    expect(c.reason.toLowerCase()).toContain("capitalization");
  });

  it("smart vs straight apostrophes is a close match", () => {
    const c = compareText("Stone's Throw", "Stone’s Throw");
    expect(c.kind).toBe("close");
  });

  it("punctuation/whitespace-only differences are close matches", () => {
    expect(compareText("OLD TOM DISTILLERY", "OLD  TOM DISTILLERY").kind).toBe("close");
  });

  it("substantively different strings are different", () => {
    expect(compareText("OTIUM CELLARS", "SANTA FE SPIRITS").kind).toBe("different");
  });
});
