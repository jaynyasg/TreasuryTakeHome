import Card from "@/components/house/Card";
import type { SourceFileView, TimelineEntryView } from "./types";
import { FilePdf, Image as ImageIcon, Cube } from "@/components/house/icons";

/**
 * Chronological Evidence Timeline + source files for Case Detail (plan "Case
 * detail IA" — timeline, source files, retries, and export history below the
 * decision + comparison + warning). A plain, scannable, keyboard-traversable
 * ordered list with absolute timestamps — no decorative motion (review-critical
 * screen). Source files are accessed through the authorized `/api/files/{id}`
 * route, never a raw object key.
 */

/** Leading marker label per kind, so the entry type is not color-only. */
const KIND_LABEL: Record<TimelineEntryView["kind"], string> = {
  attempt: "Attempt",
  state_change: "State",
  disposition: "Disposition",
  export: "Export",
  file: "File",
  audit: "Audit",
};

function fmt(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function FileGlyph({ role }: { role: string }) {
  if (role === "label" || role === "crop") return <ImageIcon size={12} />;
  if (role === "application") return <FilePdf size={12} />;
  return <Cube size={12} />;
}

export default function EvidenceTimeline({
  timeline,
  sourceFiles,
}: {
  timeline: TimelineEntryView[] | undefined;
  sourceFiles: SourceFileView[] | undefined;
}) {
  const entries = [...(timeline ?? [])].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime()
  );

  return (
    <section aria-labelledby="timeline-heading" className="flex flex-col gap-3">
      <h2
        id="timeline-heading"
        className="text-[13px] font-semibold tracking-tight text-ink"
      >
        Processing &amp; audit timeline
      </h2>

      {/* Source files */}
      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Source files
        </p>
        {!sourceFiles || sourceFiles.length === 0 ? (
          <p className="text-[12px] text-muted">
            No source files are linked to this case yet.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sourceFiles.map((f) => (
              <li key={f.id}>
                <a
                  href={`/api/files/${encodeURIComponent(f.id)}`}
                  className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-card px-2.5 py-[5px] text-[11.5px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <span aria-hidden className="text-muted-2">
                    <FileGlyph role={f.role} />
                  </span>
                  {f.name ?? f.role}
                  <span className="text-muted-2">· {f.role}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Timeline */}
      {entries.length === 0 ? (
        <Card bare className="border-dashed">
          <p className="text-[12.5px] text-muted">
            No timeline entries are available yet. Processing attempts, state
            changes, dispositions, and exports appear here as they are recorded.
          </p>
        </Card>
      ) : (
        <ol className="flex flex-col gap-0">
          {entries.map((e, i) => (
            <li
              key={e.id}
              className="relative flex gap-3 pb-4 pl-1 last:pb-0"
            >
              {/* Connector rail */}
              {i < entries.length - 1 && (
                <span
                  aria-hidden
                  className="absolute left-[7px] top-4 h-full w-px bg-line-2"
                />
              )}
              <span
                aria-hidden
                className="mt-1 h-[15px] w-[15px] shrink-0 rounded-full border-2 border-line bg-card"
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="rounded-pill border border-line bg-surface px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
                    {KIND_LABEL[e.kind]}
                  </span>
                  <time
                    dateTime={e.at}
                    className="font-mono text-[11px] text-muted-2"
                  >
                    {fmt(e.at)}
                  </time>
                </div>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">
                  {e.summary}
                </p>
                {(e.actorUserId || e.reason) && (
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">
                    {e.actorUserId ? <span>by {e.actorUserId}</span> : null}
                    {e.actorUserId && e.reason ? " — " : null}
                    {e.reason ? <span>“{e.reason}”</span> : null}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
