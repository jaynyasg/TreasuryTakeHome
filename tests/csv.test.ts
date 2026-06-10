import { describe, expect, it } from "vitest";
import { buildBatchCsv, escapeCsvField } from "@/lib/csv";
import { compareText } from "@/lib/engine/normalize";

describe("escapeCsvField (eng-review 3A)", () => {
  it("quotes fields containing commas", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
  });

  it("doubles inner quotes per RFC 4180", () => {
    expect(escapeCsvField('say "hi"')).toBe('"say ""hi"""');
  });

  it("quotes newlines", () => {
    expect(escapeCsvField("line1\nline2")).toBe('"line1\nline2"');
  });

  it("neuters formula-leading cells", () => {
    expect(escapeCsvField("=cmd()")).toBe("'=cmd()");
    expect(escapeCsvField("+1")).toBe("'+1");
    expect(escapeCsvField("@import")).toBe("'@import");
  });

  it("survives a REAL close-match reason (commas, quotes, dash)", () => {
    // The exact string class that motivated the finding.
    const reason = compareText("Stone's Throw", "STONE'S THROW").reason;
    const escaped = escapeCsvField(reason);
    expect(escaped.startsWith('"')).toBe(true);
    // Round-trip: unquote + collapse doubled quotes restores the original.
    const roundTripped = escaped.slice(1, -1).replace(/""/g, '"');
    expect(roundTripped).toBe(reason);
  });

  it("leaves plain fields untouched", () => {
    expect(escapeCsvField("OTIUM CELLARS")).toBe("OTIUM CELLARS");
  });
});

describe("buildBatchCsv", () => {
  it("produces a header plus one line per row, error rows included", () => {
    const csv = buildBatchCsv([
      {
        id: "real-otium",
        kind: "real",
        brand: "OTIUM CELLARS",
        beverageType: "wine",
        defectsInjected: "n/a",
        result: null,
        error: "upstream 503",
      },
    ]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines).toHaveLength(2);
    expect(lines[0].startsWith("case,source,brand")).toBe(true);
    expect(lines[1]).toContain("real-otium");
    expect(lines[1]).toContain("upstream 503");
  });
});
