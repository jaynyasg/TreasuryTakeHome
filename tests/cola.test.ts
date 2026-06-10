import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ColaParseError, isValidTtbId, parseColaHtml } from "@/lib/cola";

const fixture = fs.readFileSync(
  path.join(__dirname, "..", "eval", "fixtures", "cola-10200001000187.html"),
  "utf8"
);

describe("TTB ID validation (eng-review 3A)", () => {
  it("accepts exactly 14 digits", () => {
    expect(isValidTtbId("10200001000187")).toBe(true);
  });

  it.each([
    ["too short", "1020000100018"],
    ["too long", "102000010001870"],
    ["letters", "1020000100018a"],
    ["path tricks", "../../etc/passwd"],
    ["query injection", "1?action=evil"],
    ["empty", ""],
  ])("rejects %s", (_name, value) => {
    expect(isValidTtbId(value)).toBe(false);
  });
});

describe("COLA registry page parser (AC-2, fixture-tested offline)", () => {
  it("parses the OTIUM detail page into a valid application", () => {
    const { ttbid, application } = parseColaHtml(fixture);
    expect(ttbid).toBe("10200001000187");
    expect(application.brandName).toBe("OTIUM CELLARS");
    expect(application.serialNumber).toBe("100002");
    expect(application.beverageType).toBe("wine");
    expect(application.sourceOfProduct).toBe("domestic");
    expect(application.alcoholContent).toBe("12");
    expect(application.netContents).toBe("750 MILLILITERS");
    expect(application.classType).toBe("TABLE WHITE WINE");
    expect(application.wineAppellation).toBe("LOUDOUN COUNTY VIRGINIA");
    expect(application.wineVintage).toBe("2009");
    expect(application.fancifulName).toBeUndefined();
    expect(application.applicantNameAddress).toContain("EIGHT CHAINS NORTH");
    expect(application.applicantNameAddress).toContain("WATERFORD");
    expect(application.applicantNameAddress).toContain("OTIUM CELLARS");
  });

  it("throws ColaParseError on a page without the form", () => {
    expect(() => parseColaHtml("<html><body>Session expired</body></html>")).toThrow(
      ColaParseError
    );
  });

  it("throws ColaParseError on empty input", () => {
    expect(() => parseColaHtml("")).toThrow(ColaParseError);
  });
});
