/**
 * Intake preflight — deterministic summary computed before any durable
 * processing (plan T4; journey step 2: catch missing pairs, duplicates,
 * unsupported files and show estimated time/cost; "Processing does not begin
 * until the manifest is reviewable").
 *
 * `computePreflight` is a pure fold over the manifest: it counts complete /
 * incomplete / duplicate / unsupported, lists actionable issues, and estimates
 * cost and wall-clock minutes from per-case constants. No I/O, no Next.js —
 * unit-tested in `tests/intake/preflight.test.ts`.
 */
import { pairCases } from "./pairing";
import type {
  ManifestEntry,
  PreflightIssue,
  PreflightSummary,
} from "./types";

/** Cost/throughput constants for the estimate (caller supplies real values). */
export interface PreflightOptions {
  /** Estimated model+processing cost per complete case, in USD. */
  perCaseCostUsd: number;
  /** Estimated wall-clock seconds to process one case. */
  perCaseSeconds: number;
  /** How many cases process at once (the concurrency budget). */
  concurrency: number;
}

/**
 * Compute the preflight summary for a manifest.
 *
 * Counting:
 *   - `completeCases`   cases with a usable application AND label.
 *   - `incompleteCases` cases missing one side (each yields a
 *     `missing_pair_member` + `incomplete_case` issue).
 *   - `duplicates`      entries deduped by checksum (`duplicate` status).
 *   - `unsupported`     entries rejected for content type (`invalid` status).
 *
 * Estimates (deterministic):
 *   - cost    = completeCases × perCaseCostUsd
 *   - minutes = ceil(completeCases / concurrency) × perCaseSeconds / 60
 *     (a `concurrency` ≤ 0 is treated as 1 to avoid divide-by-zero/negatives).
 */
export function computePreflight(
  entries: readonly ManifestEntry[],
  opts: PreflightOptions
): PreflightSummary {
  const issues: PreflightIssue[] = [];

  let duplicates = 0;
  let unsupported = 0;
  for (const entry of entries) {
    if (entry.status === "duplicate") {
      duplicates += 1;
      issues.push({
        kind: "duplicate",
        caseKey: entry.caseKey,
        fileName: entry.fileName,
        message: `Duplicate of an already-uploaded file (same checksum); it will be skipped.`,
      });
    } else if (entry.status === "invalid") {
      unsupported += 1;
      issues.push({
        kind: "unsupported",
        caseKey: entry.caseKey,
        fileName: entry.fileName,
        message: `Unsupported file type '${entry.contentType}'. Accepted: PDF, PNG, JPEG.`,
      });
    }
  }

  const cases = pairCases(entries);
  let completeCases = 0;
  let incompleteCases = 0;
  for (const c of cases) {
    if (c.complete) {
      completeCases += 1;
      continue;
    }
    incompleteCases += 1;
    const missingSide = c.application ? "label" : "application";
    issues.push({
      kind: "missing_pair_member",
      caseKey: c.caseKey,
      message: `Case '${c.caseKey}' is missing its ${missingSide}; upload it or exclude the case before processing.`,
    });
    issues.push({
      kind: "incomplete_case",
      caseKey: c.caseKey,
      message: `Case '${c.caseKey}' will not be processed until its application/label pair is complete.`,
    });
  }

  const concurrency = opts.concurrency > 0 ? opts.concurrency : 1;
  const estimatedCostUsd = round2(completeCases * opts.perCaseCostUsd);
  const waves = Math.ceil(completeCases / concurrency);
  const estimatedMinutes = round2((waves * opts.perCaseSeconds) / 60);

  return {
    totalFiles: entries.length,
    completeCases,
    incompleteCases,
    duplicates,
    unsupported,
    estimatedCostUsd,
    estimatedMinutes,
    issues,
  };
}

/** Round to 2 decimal places (money/minutes), avoiding float drift in display. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
