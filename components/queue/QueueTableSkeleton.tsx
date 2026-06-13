/**
 * Stable-height loading skeleton for the Work Queue table (Stage 7 / T7, Wave 2).
 *
 * Matches the Core UI State Table's Work Queue / Loading cell: "Stable table
 * skeleton ... loading independently". Reduced-motion safe — the shimmer is a
 * `animate-pulse` the user's OS preference can disable; the layout meaning
 * (rows, columns) survives without motion.
 */
export default function QueueTableSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div
      className="overflow-hidden rounded-card border border-line bg-card"
      aria-hidden
    >
      <div className="hidden border-b border-line bg-surface/60 px-3 py-2 md:block">
        <div className="h-3 w-24 rounded bg-line" />
      </div>
      <ul className="divide-y divide-line">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="flex items-center gap-4 px-3 py-3.5">
            <div className="h-5 w-16 shrink-0 animate-pulse rounded-pill bg-surface" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="h-3 w-2/5 animate-pulse rounded bg-surface" />
              <div className="h-2.5 w-3/5 animate-pulse rounded bg-surface" />
            </div>
            <div className="hidden h-3 w-40 animate-pulse rounded bg-surface md:block" />
            <div className="hidden h-8 w-24 shrink-0 animate-pulse rounded-lg bg-surface md:block" />
          </li>
        ))}
      </ul>
    </div>
  );
}
