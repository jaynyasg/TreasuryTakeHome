/**
 * Pure presentation helpers for the Work Queue UI (Stage 7 / T7, Wave 2).
 *
 * Anything reusable and deterministic that the Work Queue components need but
 * that does NOT belong in the shared view nucleus (`lib/view/queue.ts`, which is
 * worker-safe and contract-level) lives here. No React, no I/O — just string and
 * date formatting — so it stays unit-testable in `tests/view/queueFormat.test.ts`.
 */

/**
 * Render an ISO-8601 timestamp as a compact, calm "updated" cue
 * (e.g. "just now", "5m ago", "3h ago", "2d ago", or a date for older rows).
 *
 * Deterministic: callers pass `now` so the output never depends on wall-clock
 * inside a render. Returns "—" for an unparseable/empty timestamp rather than
 * "Invalid Date", and never shows a future-skewed negative ("in 3m").
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";

  const diffMs = now - then;
  // Clock skew / future timestamps collapse to "just now" rather than negatives.
  if (diffMs < 45_000) return "just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  // Older than a week: show an absolute, locale-stable short date (UTC) so the
  // reviewer gets an exact day without a noisy timestamp.
  const d = new Date(then);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month} ${d.getUTCDate()}`;
}

/**
 * Absolute, human-readable timestamp for the row's `title`/tooltip and the
 * "last refreshed" cue, so the relative label always has an exact value behind
 * it. Returns "—" for an unparseable input.
 */
export function formatAbsoluteTime(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  return new Date(then).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  });
}

/**
 * Compose the case identity line's class/type + applicant tail, omitting empty
 * parts so the row never shows dangling separators ("Wine ·  · ") when
 * extraction has not populated a field. Returns "" when nothing is known.
 */
export function joinIdentityParts(parts: ReadonlyArray<string | null>): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter((p) => p.length > 0)
    .join(" · ");
}

/**
 * Short owner cue from a user id. The DTO only carries `assignedUserId` (no
 * display name), so we present a stable, compact token rather than leaking a
 * full id into a dense row. `assignedToMe` is surfaced separately by the caller.
 */
export function shortOwner(userId: string | null): string {
  if (!userId) return "Unassigned";
  const trimmed = userId.trim();
  if (trimmed.length <= 10) return trimmed;
  return `${trimmed.slice(0, 8)}…`;
}
