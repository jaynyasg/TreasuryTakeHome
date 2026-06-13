import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";

/**
 * Work Queue — Wave 1 PLACEHOLDER.
 *
 * Wave 2 (T7) replaces this with the live triage table fed by
 * `getWorkQueue(principal, ...)` from `lib/server/queries.ts`, rendered with the
 * pure helpers in `lib/view/queue.ts` (ordering, counts, issue summaries). For
 * now this resolves the default reviewer landing route so the shell + nav +
 * `next build` are exercised end-to-end.
 */
export default function WorkQueuePage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Work Queue"
        description="Triage view of assigned cases, ordered red → amber → green. Wave 2 renders the live table here."
        counts={<Badge>Placeholder — Wave 2</Badge>}
      />
      <p className="text-[13px] text-muted">Work Queue (loading)…</p>
    </div>
  );
}
