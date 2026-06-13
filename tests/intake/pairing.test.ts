import { describe, expect, it } from "vitest";
import {
  classifyFile,
  detectDuplicates,
  deriveKindAndCaseKey,
  isSupportedContentType,
  pairCases,
  type ManifestMap,
} from "@/lib/intake/pairing";
import type { ManifestEntry } from "@/lib/intake/types";

/** Build a usable entry with overridable fields. */
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

describe("classifyFile / deriveKindAndCaseKey", () => {
  it("classifies application files by name token and strips the token from the case key", () => {
    const e = classifyFile({
      fileName: "case001_application.pdf",
      contentType: "application/pdf",
      checksum: "a",
      size: 1,
    });
    expect(e.kind).toBe("application");
    expect(e.caseKey).toBe("case001");
    expect(e.status).toBe("uploaded");
  });

  it("classifies label files and shares the case key with its application", () => {
    const app = deriveKindAndCaseKey("case001_application.pdf");
    const label = deriveKindAndCaseKey("case001_label.png");
    expect(app.kind).toBe("application");
    expect(label.kind).toBe("label");
    expect(label.caseKey).toBe(app.caseKey); // both => case001
  });

  it("treats 'app' and 'form' as application tokens", () => {
    expect(deriveKindAndCaseKey("brand-app.pdf").kind).toBe("application");
    expect(deriveKindAndCaseKey("brand-form.pdf").kind).toBe("application");
  });

  it("returns unknown kind when no token is present", () => {
    expect(deriveKindAndCaseKey("random.png").kind).toBe("unknown");
    expect(deriveKindAndCaseKey("random.png").caseKey).toBe("random");
  });

  it("rejects unsupported content types as invalid", () => {
    expect(isSupportedContentType("text/plain")).toBe(false);
    const e = classifyFile({
      fileName: "case1_label.txt",
      contentType: "text/plain",
      checksum: "x",
      size: 1,
    });
    expect(e.status).toBe("invalid");
  });

  it("accepts pdf, png, and jpeg", () => {
    for (const ct of ["application/pdf", "image/png", "image/jpeg"]) {
      expect(isSupportedContentType(ct)).toBe(true);
    }
  });

  it("honors an explicit manifest map over filename inference", () => {
    const map: ManifestMap = {
      caseZ: { application: "weirdname1.pdf", label: "weirdname2.png" },
    };
    const a = classifyFile(
      { fileName: "weirdname1.pdf", contentType: "application/pdf", checksum: "a", size: 1 },
      map
    );
    const l = classifyFile(
      { fileName: "weirdname2.png", contentType: "image/png", checksum: "b", size: 1 },
      map
    );
    expect(a.kind).toBe("application");
    expect(a.caseKey).toBe("caseZ");
    expect(l.kind).toBe("label");
    expect(l.caseKey).toBe("caseZ");
  });
});

describe("detectDuplicates", () => {
  it("marks later entries with the same checksum as duplicate", () => {
    const out = detectDuplicates([
      entry({ fileName: "a.pdf", checksum: "same" }),
      entry({ fileName: "b.pdf", checksum: "same" }),
      entry({ fileName: "c.pdf", checksum: "other" }),
    ]);
    expect(out.map((e) => e.status)).toEqual([
      "uploaded",
      "duplicate",
      "uploaded",
    ]);
  });

  it("does not dedupe invalid entries or empty checksums", () => {
    const out = detectDuplicates([
      entry({ checksum: "", status: "uploaded" }),
      entry({ checksum: "", status: "uploaded" }),
      entry({ checksum: "z", status: "invalid" }),
      entry({ checksum: "z", status: "invalid" }),
    ]);
    expect(out.map((e) => e.status)).toEqual([
      "uploaded",
      "uploaded",
      "invalid",
      "invalid",
    ]);
  });
});

describe("pairCases", () => {
  it("pairs a complete application + label into one complete case", () => {
    const cases = pairCases([
      entry({ fileName: "c1_app.pdf", kind: "application", caseKey: "c1", checksum: "1" }),
      entry({ fileName: "c1_label.png", kind: "label", caseKey: "c1", checksum: "2" }),
    ]);
    expect(cases).toHaveLength(1);
    expect(cases[0].complete).toBe(true);
    expect(cases[0].application?.fileName).toBe("c1_app.pdf");
    expect(cases[0].label?.fileName).toBe("c1_label.png");
  });

  it("marks a case incomplete when the label is missing", () => {
    const cases = pairCases([
      entry({ fileName: "c1_app.pdf", kind: "application", caseKey: "c1", checksum: "1" }),
    ]);
    expect(cases[0].complete).toBe(false);
    expect(cases[0].application).toBeDefined();
    expect(cases[0].label).toBeUndefined();
  });

  it("does not fill a pair slot from a duplicate or invalid entry", () => {
    const cases = pairCases([
      entry({ fileName: "c1_app.pdf", kind: "application", caseKey: "c1", checksum: "1" }),
      entry({ fileName: "c1_label.png", kind: "label", caseKey: "c1", checksum: "2", status: "duplicate" }),
    ]);
    expect(cases[0].complete).toBe(false);
    expect(cases[0].label).toBeUndefined();
  });

  it("groups multiple cases in first-seen order", () => {
    const cases = pairCases([
      entry({ kind: "application", caseKey: "b", checksum: "1" }),
      entry({ kind: "label", caseKey: "b", checksum: "2" }),
      entry({ kind: "application", caseKey: "a", checksum: "3" }),
    ]);
    expect(cases.map((c) => c.caseKey)).toEqual(["b", "a"]);
  });
});
