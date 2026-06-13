import PageHeader from "@/components/app-shell/PageHeader";
import Card from "@/components/house/Card";

/**
 * Case Detail loading skeleton (plan "Core UI State Table" — Case Detail:
 * "Decision panel skeleton before evidence loads"). Renders the decision panel
 * shape first, then placeholder evidence sections, so the layout does not shift
 * when the real decision-first content streams in. Pulse only — no decorative
 * motion on a review-critical screen.
 */
export default function CaseDetailLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true">
      <PageHeader
        title="Case detail"
        description="Loading the decision panel…"
      />

      {/* Decision panel skeleton (loads before evidence) */}
      <Card className="flex flex-col gap-4">
        <div className="rounded-lg border border-line-2 bg-surface px-4 py-3">
          <div className="h-3 w-28 animate-pulse rounded bg-line-2" />
          <div className="mt-2 h-9 w-40 animate-pulse rounded bg-line-2" />
        </div>
        <div className="rounded-lg border border-line-2 bg-surface px-4 py-3">
          <div className="h-3 w-24 animate-pulse rounded bg-line-2" />
          <div className="mt-2 h-4 w-3/4 animate-pulse rounded bg-line-2" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-24 animate-pulse rounded-lg bg-line-2" />
          <div className="h-9 w-24 animate-pulse rounded-lg bg-line-2" />
          <div className="h-9 w-36 animate-pulse rounded-lg bg-line-2" />
        </div>
      </Card>

      {/* Evidence section placeholders */}
      <SectionSkeleton label="Application vs. label" rows={3} />
      <SectionSkeleton label="Government warning evidence" rows={2} />
      <SectionSkeleton label="Processing & audit timeline" rows={3} />

      <span className="sr-only">Loading case detail…</span>
    </div>
  );
}

function SectionSkeleton({ label, rows }: { label: string; rows: number }) {
  return (
    <section className="flex flex-col gap-2.5">
      <div className="h-3.5 w-44 animate-pulse rounded bg-line-2" aria-hidden />
      <span className="sr-only">{label} loading</span>
      <div className="flex flex-col gap-2">
        {Array.from({ length: rows }).map((_, i) => (
          <div
            key={i}
            className="h-14 w-full animate-pulse rounded-lg border border-line-2 bg-surface"
            aria-hidden
          />
        ))}
      </div>
    </section>
  );
}
