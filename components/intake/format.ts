/**
 * Pure formatting + grouping helpers for the reviewer Batch Intake screen
 * (Stage 7 Wave 2, the UI for the Stage 5 intake backend).
 *
 * No React, no I/O, no Next.js — just deterministic display logic so the
 * IntakeWorkspace stays declarative and the formatting is unit-tested in
 * `tests/view/intakeFormat.test.ts`. Everything here operates on the domain
 * shapes from `lib/intake/types.ts` (ManifestEntry, PreflightIssue) that the
 * intake API returns.
 */
import type {
  ManifestEntry,
  ManifestEntryStatus,
  PreflightIssue,
} from "@/lib/intake/types";

/** Human-readable file size; bytes → "12 KB" / "3.4 MB" (binary units). */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"] as const;
  const exp = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024))
  );
  const value = bytes / 1024 ** exp;
  // No decimals for plain bytes; one decimal otherwise, trimming a trailing .0.
  const text = exp === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${text.replace(/\.0$/, "")} ${units[exp]}`;
}

/** Estimated cost in USD → "$0.40" (always 2dp; "$0.00" for a free/empty run). */
export function formatCost(usd: number): string {
  const safe = Number.isFinite(usd) && usd > 0 ? usd : 0;
  return `$${safe.toFixed(2)}`;
}

/**
 * Estimated wall-clock minutes → a plain-language duration a non-technical
 * reviewer can read at a glance: "under a minute", "about 3 minutes",
 * "about 1 hr 5 min".
 */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "under a minute";
  if (minutes < 1) return "under a minute";
  const whole = Math.round(minutes);
  if (whole < 60) {
    return `about ${whole} minute${whole === 1 ? "" : "s"}`;
  }
  const hrs = Math.floor(whole / 60);
  const mins = whole % 60;
  const hrPart = `${hrs} hr${hrs === 1 ? "" : "s"}`;
  return mins === 0 ? `about ${hrPart}` : `about ${hrPart} ${mins} min`;
}

/** A manifest entry's status as a short reviewer-facing label. */
export const STATUS_LABEL: Readonly<Record<ManifestEntryStatus, string>> = {
  uploaded: "Uploaded",
  missing: "Missing",
  invalid: "Unsupported",
  duplicate: "Duplicate",
  excluded: "Excluded",
};

/** A file's detected kind as a short reviewer-facing label. */
export function kindLabel(kind: ManifestEntry["kind"]): string {
  if (kind === "application") return "Application";
  if (kind === "label") return "Label";
  return "Unknown";
}

/**
 * Per-status next-action guidance, in plain language for a non-technical
 * reviewer. Only the "problem" statuses get guidance; `uploaded` is fine.
 */
export const STATUS_NEXT_ACTION: Readonly<
  Partial<Record<ManifestEntryStatus, string>>
> = {
  invalid: "This file type can't be read. Upload a PDF, PNG, or JPG instead.",
  duplicate: "Already uploaded — this copy is skipped. Nothing to do.",
  missing: "Upload the missing file to complete this case, or exclude it.",
  excluded: "Excluded from this batch. It won't be processed.",
};

/**
 * Sort order for the manifest table: problems first so a reviewer never has to
 * hunt for what needs attention. invalid → missing → duplicate → excluded →
 * uploaded, then by case key, then by file name (stable, deterministic).
 */
const STATUS_RANK: Readonly<Record<ManifestEntryStatus, number>> = {
  invalid: 0,
  missing: 1,
  duplicate: 2,
  excluded: 3,
  uploaded: 4,
};

/** A manifest entry is a "problem" if it isn't a clean, processable upload. */
export function isProblemEntry(entry: ManifestEntry): boolean {
  return entry.status !== "uploaded";
}

/** How many manifest entries still need the reviewer's attention. */
export function countProblems(entries: readonly ManifestEntry[]): number {
  return entries.reduce((n, e) => (isProblemEntry(e) ? n + 1 : n), 0);
}

/**
 * Return a new array of manifest entries ordered problems-first (by status
 * rank), then by case key, then by file name. Input is not mutated.
 */
export function sortManifest(
  entries: readonly ManifestEntry[]
): ManifestEntry[] {
  return [...entries].sort((a, b) => {
    const byStatus = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (byStatus !== 0) return byStatus;
    const byCase = a.caseKey.localeCompare(b.caseKey);
    if (byCase !== 0) return byCase;
    return a.fileName.localeCompare(b.fileName);
  });
}

/** A group of preflight issues sharing a kind, with a plain-language heading. */
export interface IssueGroup {
  kind: PreflightIssue["kind"];
  heading: string;
  /** Plain-language guidance shared by every issue in the group. */
  guidance: string;
  issues: PreflightIssue[];
}

const ISSUE_GROUP_META: Readonly<
  Record<PreflightIssue["kind"], { heading: string; guidance: string }>
> = {
  missing_pair_member: {
    heading: "Missing a paired file",
    guidance:
      "Each case needs both an application and a label. Upload the missing file, or exclude the case before you start.",
  },
  incomplete_case: {
    heading: "Cases that won't be processed yet",
    guidance:
      "These cases are incomplete and will be skipped until their pair is complete.",
  },
  duplicate: {
    heading: "Duplicate files (skipped)",
    guidance:
      "You already uploaded these files. The copies are skipped automatically — nothing to fix.",
  },
  unsupported: {
    heading: "File types we can't read",
    guidance:
      "These files were rejected. Re-upload them as a PDF, PNG, or JPG.",
  },
};

/**
 * Group preflight issues by kind, in a fixed reviewer-priority order
 * (missing → incomplete → unsupported → duplicate), dropping empty groups.
 * Gives the PreflightPanel a small, stable set of grouped sections instead of a
 * flat wall of messages.
 */
export function groupIssues(
  issues: readonly PreflightIssue[]
): IssueGroup[] {
  const ORDER: PreflightIssue["kind"][] = [
    "missing_pair_member",
    "incomplete_case",
    "unsupported",
    "duplicate",
  ];
  const byKind = new Map<PreflightIssue["kind"], PreflightIssue[]>();
  for (const issue of issues) {
    const bucket = byKind.get(issue.kind) ?? [];
    bucket.push(issue);
    byKind.set(issue.kind, bucket);
  }
  const groups: IssueGroup[] = [];
  for (const kind of ORDER) {
    const bucket = byKind.get(kind);
    if (!bucket || bucket.length === 0) continue;
    const meta = ISSUE_GROUP_META[kind];
    groups.push({ kind, heading: meta.heading, guidance: meta.guidance, issues: bucket });
  }
  return groups;
}
