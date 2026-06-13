import type { ReconciliationRowDTO } from "@/lib/server/adminDto";
import {
  summarizeReconciliation,
  type ReconciliationSummary,
} from "@/lib/view/admin";
import StatusPill from "./StatusPill";
import { groupReconciliation, shortId } from "./format";

/**
 * Storage reconciliation table (plan "Storage consistency"). The MAIN surface of
 * the Storage tab. Cross-checks the DB object manifest against the blob store
 * and renders the two finding kinds in separate sections:
 *   - `missing_blob`: a DB manifest row points at an object key with no blob,
 *   - `orphaned_blob`: a blob exists with no DB manifest row referencing it.
 *
 * A {@link summarizeReconciliation} health banner sits above the table. Repair /
 * delete actions are intentionally STUBBED as a clear manual note for this
 * prototype (plan permits "coming soon"): missing blobs need a re-derive/replay
 * decision and orphaned blobs need a confirmed delete — both are deferred to a
 * dedicated tool, so the table is read-and-triage only here.
 *
 * Pure presentational + server-renderable (no interactivity); semantic tables
 * with captions + scoped headers, severity never color-only.
 */
export default function ReconciliationTable({
  rows,
}: {
  rows: readonly ReconciliationRowDTO[];
}) {
  const summary = summarizeReconciliation(rows);
  const { missing, orphaned } = groupReconciliation(rows);

  return (
    <div className="flex flex-col gap-4">
      <ReconciliationBanner summary={summary} />

      <ReconciliationSection
        title="Missing blobs"
        description="DB manifest rows whose blob is absent from the store. Re-derive or replay the owning case to restore the artifact."
        emptyLabel="No missing blobs."
        rows={missing}
        showAggregateId
      />

      <ReconciliationSection
        title="Orphaned blobs"
        description="Blobs with no DB manifest row. Confirm before deleting — an untracked object may belong to an in-flight write."
        emptyLabel="No orphaned blobs."
        rows={orphaned}
        showAggregateId={false}
      />
    </div>
  );
}

function ReconciliationBanner({ summary }: { summary: ReconciliationSummary }) {
  if (summary.healthy) {
    return (
      <div
        role="status"
        className="flex items-center gap-2 rounded-card border border-accent-green/40 bg-accent-green/10 px-3 py-2 text-[12.5px] text-ink"
      >
        <StatusPill tone="ok">Reconciled</StatusPill>
        <span>Every manifest row has its blob and every blob has its row.</span>
      </div>
    );
  }
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-card border border-accent-amber/50 bg-accent-amber/10 px-3 py-2 text-[12.5px] text-ink"
    >
      <StatusPill tone="warn">Drift detected</StatusPill>
      <span>
        {summary.missing} missing {summary.missing === 1 ? "blob" : "blobs"} ·{" "}
        {summary.orphaned} orphaned{" "}
        {summary.orphaned === 1 ? "blob" : "blobs"}. Repair / delete tooling is
        coming soon — triage manually for now.
      </span>
    </div>
  );
}

function ReconciliationSection({
  title,
  description,
  emptyLabel,
  rows,
  showAggregateId,
}: {
  title: string;
  description: string;
  emptyLabel: string;
  rows: readonly ReconciliationRowDTO[];
  showAggregateId: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div>
        <h2 className="text-[13px] font-semibold text-ink">
          {title}{" "}
          <span className="font-normal text-muted">({rows.length})</span>
        </h2>
        <p className="mt-0.5 max-w-2xl text-[12px] text-muted">{description}</p>
      </div>
      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            {title}. {rows.length} findings.
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface/60">
              <th
                scope="col"
                className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted"
              >
                Object key
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted"
              >
                Aggregate type
              </th>
              {showAggregateId && (
                <th
                  scope="col"
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted"
                >
                  Aggregate id
                </th>
              )}
              <th
                scope="col"
                className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-[0.06em] text-muted"
              >
                Action
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={`${row.issue}:${row.objectKey}`}
                className="border-b border-line last:border-b-0 hover:bg-surface/40"
              >
                <td className="px-3 py-3 align-top">
                  <span className="font-mono text-[12px] text-ink" title={row.objectKey}>
                    {shortId(row.objectKey, 18, 8)}
                  </span>
                </td>
                <td className="px-3 py-3 align-top text-[12.5px] text-ink-2">
                  {row.aggregateType}
                </td>
                {showAggregateId && (
                  <td className="px-3 py-3 align-top">
                    <span className="font-mono text-[12px] text-ink-2" title={row.aggregateId ?? undefined}>
                      {row.aggregateId ? shortId(row.aggregateId) : "—"}
                    </span>
                  </td>
                )}
                <td className="px-3 py-3 text-right align-top">
                  <span className="text-[11.5px] text-muted-2">
                    Manual — coming soon
                  </span>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={showAggregateId ? 4 : 3}
                  className="px-3 py-6 text-center text-[13px] text-muted"
                >
                  {emptyLabel}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
