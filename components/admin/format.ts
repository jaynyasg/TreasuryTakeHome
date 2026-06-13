/**
 * Pure presentational helpers for the admin Operations Console UI (Stage 8 /
 * T8+T9). NO I/O, NO React — just deterministic formatting + grouping over the
 * admin DTOs so the table components stay declarative and the logic is unit-
 * testable (`tests/view/adminFormat.test.ts`).
 *
 * The richer view nucleus (tile classification, durations, spend, heartbeat,
 * reconciliation summary) already lives in `lib/view/admin.ts`; THIS file adds
 * only the small UI-side helpers the table components need (export-status
 * presentation, reconciliation row grouping, compact timestamp formatting,
 * short id/owner display).
 */
import type {
  ExportRowDTO,
  ReconciliationRowDTO,
} from "@/lib/server/adminDto";

/** A health level mirrored from the view nucleus, for badge tone selection. */
export type StatusTone = "ok" | "warn" | "alert" | "neutral";

/** Presentation for one export status: a human label + a severity tone. */
export interface ExportStatusView {
  label: string;
  tone: StatusTone;
  /** True when the artifact is downloadable (a terminal, blob-backed status). */
  downloadable: boolean;
}

/**
 * Map an {@link ExportRowDTO.status} to its label + tone + downloadability.
 *   - `complete` → ok, downloadable
 *   - `partial`  → warn, downloadable (point-in-time, some cases still moving)
 *   - `generating` → neutral, not downloadable yet
 *   - `failed`   → alert, not downloadable
 * A row is only downloadable when its status is terminal AND it carries an
 * object key — callers pass the key separately (status alone never implies one).
 */
export function exportStatusView(
  status: ExportRowDTO["status"]
): ExportStatusView {
  switch (status) {
    case "complete":
      return { label: "Complete", tone: "ok", downloadable: true };
    case "partial":
      return { label: "Partial", tone: "warn", downloadable: true };
    case "generating":
      return { label: "Generating…", tone: "neutral", downloadable: false };
    case "failed":
      return { label: "Failed", tone: "alert", downloadable: false };
    default:
      // Defensive: an unexpected status never crashes the table.
      return { label: String(status), tone: "neutral", downloadable: false };
  }
}

/** Whether a row can actually be downloaded: terminal status AND a real key. */
export function exportIsDownloadable(row: ExportRowDTO): boolean {
  return exportStatusView(row.status).downloadable && !!row.objectKey;
}

/** Reconciliation rows split into the two finding buckets, preserving order. */
export interface GroupedReconciliation {
  missing: ReconciliationRowDTO[];
  orphaned: ReconciliationRowDTO[];
}

/**
 * Group reconciliation findings into `missing_blob` / `orphaned_blob` buckets
 * (plan "Storage consistency"). The two failure directions have different
 * repair paths, so the table renders them as separate sections. Row order
 * within each bucket is preserved.
 */
export function groupReconciliation(
  rows: readonly ReconciliationRowDTO[]
): GroupedReconciliation {
  const missing: ReconciliationRowDTO[] = [];
  const orphaned: ReconciliationRowDTO[] = [];
  for (const row of rows) {
    if (row.issue === "missing_blob") missing.push(row);
    else if (row.issue === "orphaned_blob") orphaned.push(row);
  }
  return { missing, orphaned };
}

/**
 * Format an ISO-8601 timestamp as a compact, locale-stable UTC string for dense
 * operational tables: "2026-06-13 12:30 UTC". Returns "—" for null/unparseable
 * input so a missing timestamp never renders as "Invalid Date".
 */
export function formatTimestamp(at: string | null | undefined): string {
  if (!at) return "—";
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return "—";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
  );
}

/**
 * Shorten a long opaque id (UUID, object key) for table display while keeping
 * it recognizable: keeps the first `head` and last `tail` characters with an
 * ellipsis between. Short ids pass through unchanged. Null/empty → "—".
 */
export function shortId(
  id: string | null | undefined,
  head = 8,
  tail = 4
): string {
  if (!id) return "—";
  if (id.length <= head + tail + 1) return id;
  return `${id.slice(0, head)}…${id.slice(-tail)}`;
}
