import { describe, expect, it } from "vitest";
import {
  exportStatusView,
  exportIsDownloadable,
  groupReconciliation,
  formatTimestamp,
  shortId,
} from "@/components/admin/format";
import type {
  ExportRowDTO,
  ReconciliationRowDTO,
} from "@/lib/server/adminDto";

function exportRow(over: Partial<ExportRowDTO> = {}): ExportRowDTO {
  return {
    id: "exp-1",
    batchId: "batch-1",
    status: "complete",
    objectKey: "exports/batch-1/exp-1.csv",
    createdAt: "2026-06-13T12:00:00.000Z",
    requestedBy: "admin-1",
    ...over,
  };
}

function recon(
  issue: ReconciliationRowDTO["issue"],
  key: string
): ReconciliationRowDTO {
  return {
    objectKey: key,
    issue,
    aggregateType: issue === "missing_blob" ? "case_file" : "unknown",
    aggregateId: issue === "missing_blob" ? "case-1" : null,
  };
}

describe("exportStatusView", () => {
  it("maps complete to a downloadable ok status", () => {
    const v = exportStatusView("complete");
    expect(v).toEqual({ label: "Complete", tone: "ok", downloadable: true });
  });

  it("maps partial to a downloadable warn status", () => {
    const v = exportStatusView("partial");
    expect(v.tone).toBe("warn");
    expect(v.downloadable).toBe(true);
  });

  it("maps generating to a non-downloadable neutral status", () => {
    const v = exportStatusView("generating");
    expect(v.tone).toBe("neutral");
    expect(v.downloadable).toBe(false);
  });

  it("maps failed to a non-downloadable alert status", () => {
    const v = exportStatusView("failed");
    expect(v.tone).toBe("alert");
    expect(v.downloadable).toBe(false);
  });
});

describe("exportIsDownloadable", () => {
  it("is true only when status is terminal AND an object key exists", () => {
    expect(exportIsDownloadable(exportRow({ status: "complete" }))).toBe(true);
    expect(exportIsDownloadable(exportRow({ status: "partial" }))).toBe(true);
  });

  it("is false when a complete export somehow has no object key", () => {
    expect(
      exportIsDownloadable(exportRow({ status: "complete", objectKey: null }))
    ).toBe(false);
  });

  it("is false for generating/failed even with a key", () => {
    expect(exportIsDownloadable(exportRow({ status: "generating" }))).toBe(
      false
    );
    expect(exportIsDownloadable(exportRow({ status: "failed" }))).toBe(false);
  });
});

describe("groupReconciliation", () => {
  it("splits findings into missing/orphaned buckets preserving order", () => {
    const rows = [
      recon("missing_blob", "a"),
      recon("orphaned_blob", "b"),
      recon("missing_blob", "c"),
    ];
    const grouped = groupReconciliation(rows);
    expect(grouped.missing.map((r) => r.objectKey)).toEqual(["a", "c"]);
    expect(grouped.orphaned.map((r) => r.objectKey)).toEqual(["b"]);
  });

  it("returns empty buckets for no findings", () => {
    expect(groupReconciliation([])).toEqual({ missing: [], orphaned: [] });
  });
});

describe("formatTimestamp", () => {
  it("formats an ISO timestamp as compact UTC", () => {
    expect(formatTimestamp("2026-06-13T12:30:00.000Z")).toBe(
      "2026-06-13 12:30 UTC"
    );
  });

  it("returns a dash for null/empty/unparseable input", () => {
    expect(formatTimestamp(null)).toBe("—");
    expect(formatTimestamp(undefined)).toBe("—");
    expect(formatTimestamp("not-a-date")).toBe("—");
  });
});

describe("shortId", () => {
  it("shortens a long id keeping head and tail", () => {
    expect(shortId("0123456789abcdef0123", 8, 4)).toBe("01234567…0123");
  });

  it("passes short ids through unchanged", () => {
    expect(shortId("short")).toBe("short");
  });

  it("returns a dash for null/empty", () => {
    expect(shortId(null)).toBe("—");
    expect(shortId("")).toBe("—");
  });
});
