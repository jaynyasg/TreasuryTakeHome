import { VerifyResponse } from "@/lib/contract";

/**
 * RFC-4180 CSV with formula neutering (eng-review 3A): verdict reasons contain
 * commas and quotes, and the export is pitched as the audit artifact agents
 * open in Excel — so quoting and injection-hardening are correctness, not polish.
 */

export function escapeCsvField(value: string): string {
  let v = value;
  // Excel/Sheets treat leading = + - @ as formulas; neutralize with a quote.
  if (/^[=+\-@]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export interface BatchCsvRow {
  id: string;
  kind: "synthetic" | "real" | "degraded";
  brand: string;
  beverageType: string;
  defectsInjected: string; // description list, or "n/a" for real/degraded
  result: VerifyResponse | null;
  error: string | null;
}

export const BATCH_CSV_HEADER = [
  "case",
  "source",
  "brand",
  "beverage_type",
  "defects_injected",
  "match_pct",
  "overall",
  "flagged_fields",
  "verdict_reasons",
  "elapsed_ms",
  "error",
];

export function buildBatchCsv(rows: BatchCsvRow[]): string {
  const lines = [BATCH_CSV_HEADER.join(",")];
  for (const r of rows) {
    const report = r.result?.report ?? null;
    const flagged = report
      ? report.verdicts
          .filter((v) => v.status === "mismatch" || v.status === "missing_on_label" || v.status === "needs_review")
          .map((v) => `${v.field}:${v.status}`)
          .join("; ")
      : "";
    const reasons = report
      ? report.verdicts
          .filter((v) => v.status !== "not_applicable")
          .map((v) => `${v.field}: ${v.reason}`)
          .join(" | ")
      : "";
    const cells = [
      r.id,
      r.kind,
      r.brand,
      r.beverageType,
      r.defectsInjected,
      report ? String(report.matchPercentage) : "",
      report ? report.overall : "",
      flagged,
      reasons,
      r.result ? String(r.result.elapsedMs) : "",
      r.error ?? "",
    ];
    lines.push(cells.map(escapeCsvField).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
