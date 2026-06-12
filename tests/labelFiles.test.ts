import { describe, expect, it } from "vitest";
import {
  ACCEPTED_LABEL_FILE_TYPES,
  ensureSupportedDataUrlMime,
  formatBytes,
  inferSupportedLabelMime,
  isSupportedLabelDataUrl,
  isSupportedLabelFile,
  MAX_LABEL_UPLOAD_BYTES,
} from "@/lib/labelFiles";

describe("label file helpers", () => {
  it("accepts image and PDF data URLs", () => {
    expect(isSupportedLabelDataUrl("data:image/png;base64,aGk=")).toBe(true);
    expect(isSupportedLabelDataUrl("data:application/pdf;base64,aGk=")).toBe(true);
  });

  it("rejects non-label data URLs", () => {
    expect(isSupportedLabelDataUrl("data:text/plain;base64,aGk=")).toBe(false);
    expect(isSupportedLabelDataUrl("https://example.com/label.pdf")).toBe(false);
  });

  it("infers supported MIME types from filenames when the browser gives no useful type", () => {
    expect(inferSupportedLabelMime({ name: "label.pdf", type: "" })).toBe("application/pdf");
    expect(inferSupportedLabelMime({ name: "label.JPG", type: "application/octet-stream" })).toBe("image/jpeg");
    expect(isSupportedLabelFile({ name: "notes.txt", type: "" })).toBe(false);
  });

  it("normalizes data URLs with missing MIME types for supported files", () => {
    expect(ensureSupportedDataUrlMime("data:;base64,aGk=", { name: "label.pdf", type: "" })).toBe(
      "data:application/pdf;base64,aGk="
    );
  });

  it("advertises PDF extensions and formats the upload limit", () => {
    expect(ACCEPTED_LABEL_FILE_TYPES).toContain(".pdf");
    expect(formatBytes(MAX_LABEL_UPLOAD_BYTES)).toBe("3.0 MB");
  });
});
