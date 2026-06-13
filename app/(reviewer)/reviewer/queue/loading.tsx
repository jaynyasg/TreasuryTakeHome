import PageHeader from "@/components/app-shell/PageHeader";
import QueueTableSkeleton from "@/components/queue/QueueTableSkeleton";

/**
 * Route-level loading UI for the Work Queue (Stage 7 / T7, Wave 2).
 *
 * Shown during a full navigation into `/reviewer/queue` (the in-page
 * `<Suspense>` boundary handles filter/cursor changes). Keeps the header and a
 * stable-height table skeleton so the layout doesn't jump when data arrives.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Work Queue"
        description="Assigned cases, ordered red → amber → green. The machine verdict is advisory; your disposition is authoritative."
      />
      <div className="flex flex-wrap gap-1.5" aria-hidden>
        <div className="h-6 w-16 animate-pulse rounded-pill bg-surface" />
        <div className="h-6 w-20 animate-pulse rounded-pill bg-surface" />
        <div className="h-6 w-20 animate-pulse rounded-pill bg-surface" />
      </div>
      <p className="sr-only" role="status" aria-live="polite">
        Loading work queue…
      </p>
      <QueueTableSkeleton />
    </div>
  );
}
