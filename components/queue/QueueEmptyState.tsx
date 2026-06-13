import Link from "next/link";

/**
 * Empty-state for the Work Queue (Stage 7 / T7, Wave 2).
 *
 * Mirrors the Core UI State Table's Work Queue / Empty cell: "No assigned
 * cases" with an intake link and — for admins — a hint that unassigned work may
 * exist under the "All" assignment view. Calm and utility-first (Anti-Generic UI
 * Constraints): a bordered panel, not a marketing hero.
 */
export default function QueueEmptyState({
  isAdmin,
  filtered,
}: {
  isAdmin: boolean;
  /** True when filters are active, so we suggest clearing them vs. starting intake. */
  filtered: boolean;
}) {
  return (
    <div className="rounded-card border border-dashed border-line bg-card px-5 py-8 text-center">
      <p className="text-[14px] font-medium text-ink">
        {filtered ? "No cases match these filters" : "No assigned cases"}
      </p>
      <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-muted">
        {filtered
          ? "Adjust or clear the severity, status, and assignment filters to see more of the queue."
          : "When a batch is assigned to you, its cases appear here ordered red → amber → green. Start a new batch from Intake."}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {filtered ? (
          <Link
            href="/reviewer/queue"
            className="inline-flex min-h-[40px] items-center rounded-lg bg-ink px-3 text-[13px] font-medium text-white transition hover:bg-[#2c2620] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            Clear filters
          </Link>
        ) : (
          <Link
            href="/reviewer/intake"
            className="inline-flex min-h-[40px] items-center rounded-lg bg-ink px-3 text-[13px] font-medium text-white transition hover:bg-[#2c2620] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            Go to Intake
          </Link>
        )}
      </div>
      {isAdmin && !filtered && (
        <p className="mt-3 text-[12px] text-muted-2">
          Admin: switch the assignment filter to <span className="font-medium text-ink-2">All</span> to
          see unassigned cases across every batch.
        </p>
      )}
    </div>
  );
}
