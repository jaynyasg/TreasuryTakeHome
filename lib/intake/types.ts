/**
 * Batch Intake Concierge — shared domain types (plan T4: "Build manifest-driven
 * resumable batch intake and preflight"; "Temporal Decisions" → Idempotent
 * intake / Resumable uploads).
 *
 * These describe the *manifest*: the in-memory record of every file a reviewer
 * uploads for a batch, how it was classified into an application/label pair, and
 * whether it is usable. The manifest — not the blob store — is the source of
 * truth for what will be processed (plan "Storage consistency"), and it is what
 * makes uploads resumable: a re-uploaded file is recognised by checksum and
 * skipped rather than re-stored (plan "Resumable uploads").
 *
 * Pure data only — no I/O, no Next.js, no provider SDK imports. The pairing and
 * preflight functions over these types live in `pairing.ts` / `preflight.ts` and
 * are fully unit-tested.
 */

/**
 * Lifecycle of one manifest entry.
 *   - `uploaded`   accepted, stored, and counted toward a case pair.
 *   - `missing`    an expected pair member (e.g. label) that never arrived.
 *   - `invalid`    unsupported content type (rejected before storage).
 *   - `duplicate`  same checksum as an earlier entry — skipped, not re-stored.
 *   - `excluded`   explicitly dropped by the reviewer, not processed.
 */
export type ManifestEntryStatus =
  | "uploaded"
  | "missing"
  | "invalid"
  | "duplicate"
  | "excluded";

/** Which side of the application/label pair a file was classified as. */
export type FileKind = "application" | "label" | "unknown";

/**
 * One uploaded (or expected) file within an intake session's manifest.
 *
 * `caseKey` is the pairing key derived from the filename (kind tokens stripped):
 * `case001_application.pdf` and `case001_label.png` share caseKey `case001` and
 * therefore form one case. `checksum` is the sha256 the storage seam reports,
 * which drives duplicate detection and resumable re-upload skipping.
 */
export interface ManifestEntry {
  fileName: string;
  kind: FileKind;
  caseKey: string;
  checksum: string;
  size: number;
  contentType: string;
  status: ManifestEntryStatus;
}

/** A single preflight finding the reviewer should resolve before processing. */
export interface PreflightIssue {
  kind:
    | "missing_pair_member"
    | "duplicate"
    | "unsupported"
    | "incomplete_case";
  caseKey?: string;
  fileName?: string;
  message: string;
}

/**
 * Deterministic preflight summary shown before any durable processing begins
 * (plan journey step 2: "Preflight catches missing pairs, duplicates,
 * unsupported files, and estimated time/cost" — "Processing does not begin until
 * the manifest is reviewable"). Cost/time are estimates, never a charge.
 */
export interface PreflightSummary {
  totalFiles: number;
  completeCases: number;
  incompleteCases: number;
  duplicates: number;
  unsupported: number;
  estimatedCostUsd: number;
  estimatedMinutes: number;
  issues: PreflightIssue[];
}
