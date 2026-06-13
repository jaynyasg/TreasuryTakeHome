/**
 * Intake file pairing — pure classification + pairing logic (plan T4; "Resumable
 * uploads": the manifest tracks every expected file and its state, and pairs
 * must be complete before processing).
 *
 * Three responsibilities, all pure and deterministic:
 *   1. `classifyFile`   — derive {kind, caseKey} from a filename, reject
 *                         unsupported content types.
 *   2. `detectDuplicates` — same checksum ⇒ later entries become `duplicate`
 *                         (the resumable-upload dedupe rule: only the first copy
 *                         is stored/processed).
 *   3. `pairCases`      — group entries by caseKey into application/label pairs
 *                         and report completeness.
 *
 * An optional explicit manifest map overrides filename inference, so a reviewer
 * who knows the pairing can name files freely (plan: "manifest support").
 *
 * No I/O, no Next.js, no provider SDK — unit-tested in `tests/intake/`.
 */
import type { FileKind, ManifestEntry } from "./types";

/** Content types we accept for intake. Anything else is rejected `invalid`. */
const SUPPORTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
]);

/** Filename tokens that mark a file as the application side of a pair. */
const APPLICATION_TOKENS = ["application", "app", "form"] as const;
/** Filename tokens that mark a file as the label side of a pair. */
const LABEL_TOKENS = ["label"] as const;

/**
 * Explicit pairing override: caseKey → the application/label filenames the
 * reviewer declares for that case. When supplied, a filename listed here is
 * classified by its declared role/case rather than by filename inference.
 */
export type ManifestMap = Record<
  string,
  { application: string; label: string }
>;

/** Inputs to {@link classifyFile} — the raw facts a stored object reports. */
export interface ClassifyInput {
  fileName: string;
  contentType: string;
  checksum: string;
  size: number;
}

/** True when `contentType` is one intake accepts. */
export function isSupportedContentType(contentType: string): boolean {
  return SUPPORTED_CONTENT_TYPES.has(contentType.toLowerCase().trim());
}

/** Strip the directory prefix and extension from a filename, lowercased. */
function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return stem.toLowerCase();
}

/** Split a stem into its lowercased word tokens (on `_`, `-`, space, `.`). */
function tokens(stem: string): string[] {
  return stem.split(/[\s._-]+/).filter((t) => t.length > 0);
}

/**
 * Derive a file's {kind, caseKey} from its filename.
 *   - kind: a stem token matching an application token ⇒ `application`; a label
 *     token ⇒ `label`; otherwise `unknown`.
 *   - caseKey: the stem with the matched kind tokens removed, re-joined by `-`.
 *     `case001_application.pdf` ⇒ `case001`; `case001_label.png` ⇒ `case001`.
 *     A stem of only kind tokens falls back to the full stem so the key is never
 *     empty.
 */
export function deriveKindAndCaseKey(fileName: string): {
  kind: FileKind;
  caseKey: string;
} {
  const stem = fileStem(fileName);
  const parts = tokens(stem);

  let kind: FileKind = "unknown";
  const keyParts: string[] = [];
  for (const part of parts) {
    if ((APPLICATION_TOKENS as readonly string[]).includes(part)) {
      kind = "application";
      continue; // kind token: not part of the case key
    }
    if ((LABEL_TOKENS as readonly string[]).includes(part)) {
      kind = "label";
      continue;
    }
    keyParts.push(part);
  }

  const caseKey = keyParts.length > 0 ? keyParts.join("-") : stem;
  return { kind, caseKey };
}

/**
 * Classify a single uploaded file into a {@link ManifestEntry}.
 *
 * Unsupported content types are rejected as `invalid` (kind/caseKey still
 * derived so the issue can name the file). Supported files start `uploaded`; a
 * later {@link detectDuplicates} pass may downgrade them to `duplicate`.
 *
 * When `manifestMap` is supplied and lists this filename, the declared
 * role/caseKey override filename inference.
 */
export function classifyFile(
  input: ClassifyInput,
  manifestMap?: ManifestMap
): ManifestEntry {
  const supported = isSupportedContentType(input.contentType);

  const override = manifestMap
    ? lookupManifest(manifestMap, input.fileName)
    : null;

  const { kind, caseKey } = override ?? deriveKindAndCaseKey(input.fileName);

  return {
    fileName: input.fileName,
    kind,
    caseKey,
    checksum: input.checksum,
    size: input.size,
    contentType: input.contentType,
    status: supported ? "uploaded" : "invalid",
  };
}

/** Find a filename in the explicit manifest map; returns its declared role. */
function lookupManifest(
  manifestMap: ManifestMap,
  fileName: string
): { kind: FileKind; caseKey: string } | null {
  for (const [caseKey, pair] of Object.entries(manifestMap)) {
    if (pair.application === fileName) return { kind: "application", caseKey };
    if (pair.label === fileName) return { kind: "label", caseKey };
  }
  return null;
}

/**
 * Mark duplicate uploads by checksum (the resumable-upload rule): the FIRST
 * entry seen for a checksum keeps its status; every later entry with the same
 * checksum becomes `duplicate` so it is neither stored again nor processed.
 *
 * Already-`invalid` entries are left as-is (an unsupported file is rejected
 * regardless of duplication). Empty checksums are not deduped (no bytes to
 * compare). Returns a new array; inputs are not mutated.
 */
export function detectDuplicates(
  entries: readonly ManifestEntry[]
): ManifestEntry[] {
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (entry.status === "invalid" || entry.checksum === "") return entry;
    if (seen.has(entry.checksum)) {
      return { ...entry, status: "duplicate" };
    }
    seen.add(entry.checksum);
    return entry;
  });
}

/** A case's application/label pair, grouped by caseKey. */
export interface PairedCase {
  caseKey: string;
  application?: ManifestEntry;
  label?: ManifestEntry;
  /** True when the case has exactly one usable application AND one usable label. */
  complete: boolean;
}

/**
 * Group manifest entries into cases by `caseKey`. Within a case the first usable
 * (`uploaded`) application becomes `application` and the first usable label
 * becomes `label`; a case is `complete` only with both present.
 *
 * `invalid` / `duplicate` / `excluded` entries never satisfy a pair slot — they
 * are surfaced as preflight issues elsewhere, not silently used. Cases are
 * returned in first-seen order for deterministic output.
 */
export function pairCases(entries: readonly ManifestEntry[]): PairedCase[] {
  const order: string[] = [];
  const byKey = new Map<string, PairedCase>();

  for (const entry of entries) {
    let group = byKey.get(entry.caseKey);
    if (!group) {
      group = { caseKey: entry.caseKey, complete: false };
      byKey.set(entry.caseKey, group);
      order.push(entry.caseKey);
    }
    if (entry.status !== "uploaded") continue;
    if (entry.kind === "application" && !group.application) {
      group.application = entry;
    } else if (entry.kind === "label" && !group.label) {
      group.label = entry;
    }
  }

  for (const key of order) {
    const group = byKey.get(key);
    if (group) group.complete = Boolean(group.application && group.label);
  }

  return order.map((key) => byKey.get(key) as PairedCase);
}
