"use client";

import Badge from "@/components/house/Badge";
import { FilePdf, Image as ImageIcon } from "@/components/house/icons";
import type { ManifestEntry, ManifestEntryStatus } from "@/lib/intake/types";
import {
  formatBytes,
  isProblemEntry,
  kindLabel,
  sortManifest,
  STATUS_LABEL,
  STATUS_NEXT_ACTION,
} from "./format";

/**
 * Per-file manifest list for the Batch Intake screen (Stage 7 Wave 2).
 *
 * One row per uploaded file: name, detected kind (application/label/unknown),
 * case key, a status badge, and size. Rows are sorted problems-first
 * (`sortManifest`) so a reviewer never hunts for what needs attention, and any
 * problem row carries a plain-language next-action line directly beneath it.
 *
 * Renders as a real `<table>` on desktop for dense scanning and as stacked
 * cards on mobile (the responsive spec: large manifest review prefers desktop,
 * but the list must still be readable on narrow viewports).
 */
const STATUS_BADGE: Readonly<Record<ManifestEntryStatus, string>> = {
  uploaded: "border-accent-green/40 bg-accent-green/10 text-accent-green",
  duplicate: "border-line bg-surface text-muted",
  invalid: "border-accent-red/40 bg-accent-red/10 text-accent-red",
  missing: "border-accent-amber/50 bg-accent-amber/10 text-ink-2",
  excluded: "border-line bg-surface text-muted",
};

function FileIcon({ contentType }: { contentType: string }) {
  return contentType.includes("pdf") ? (
    <FilePdf size={18} />
  ) : (
    <ImageIcon size={18} />
  );
}

function StatusBadge({ status }: { status: ManifestEntryStatus }) {
  return <Badge className={STATUS_BADGE[status]}>{STATUS_LABEL[status]}</Badge>;
}

export default function ManifestTable({
  entries,
}: {
  entries: readonly ManifestEntry[];
}) {
  if (entries.length === 0) return null;
  const rows = sortManifest(entries);

  return (
    <div>
      {/* Desktop: dense table. */}
      <table className="hidden w-full border-collapse text-left sm:table">
        <caption className="sr-only">
          Uploaded files, with detected kind, case, status, and size
        </caption>
        <thead>
          <tr className="border-b border-line text-[11px] font-semibold uppercase tracking-[0.06em] text-muted">
            <th scope="col" className="py-2 pr-3 font-semibold">File</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Kind</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Case</th>
            <th scope="col" className="py-2 pr-3 font-semibold">Status</th>
            <th scope="col" className="py-2 pr-3 text-right font-semibold">Size</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((entry, i) => {
            const action = STATUS_NEXT_ACTION[entry.status];
            return (
              <tr
                key={`${entry.fileName}-${entry.checksum}-${i}`}
                className={
                  "border-b border-line-2 align-top " +
                  (isProblemEntry(entry) ? "bg-surface/40" : "")
                }
              >
                <td className="py-2.5 pr-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 shrink-0 text-muted">
                      <FileIcon contentType={entry.contentType} />
                    </span>
                    <div className="min-w-0">
                      <span
                        className="block truncate text-[12.5px] font-medium text-ink-2"
                        title={entry.fileName}
                      >
                        {entry.fileName}
                      </span>
                      {action && (
                        <span className="mt-0.5 block text-[11.5px] text-muted">
                          {action}
                        </span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="py-2.5 pr-3 text-[12px] text-ink-2">
                  {kindLabel(entry.kind)}
                </td>
                <td className="py-2.5 pr-3 font-mono text-[11.5px] text-muted">
                  {entry.caseKey}
                </td>
                <td className="py-2.5 pr-3">
                  <StatusBadge status={entry.status} />
                </td>
                <td className="py-2.5 pr-3 text-right text-[12px] text-muted">
                  {formatBytes(entry.size)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Mobile: stacked cards. */}
      <ul className="space-y-2 sm:hidden">
        {rows.map((entry, i) => {
          const action = STATUS_NEXT_ACTION[entry.status];
          return (
            <li
              key={`m-${entry.fileName}-${entry.checksum}-${i}`}
              className={
                "rounded-lg border border-line-2 p-3 " +
                (isProblemEntry(entry) ? "bg-surface/50" : "bg-card")
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-start gap-2">
                  <span className="mt-0.5 shrink-0 text-muted">
                    <FileIcon contentType={entry.contentType} />
                  </span>
                  <span
                    className="min-w-0 truncate text-[12.5px] font-medium text-ink-2"
                    title={entry.fileName}
                  >
                    {entry.fileName}
                  </span>
                </div>
                <StatusBadge status={entry.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
                <span>{kindLabel(entry.kind)}</span>
                <span className="font-mono">{entry.caseKey}</span>
                <span>{formatBytes(entry.size)}</span>
              </div>
              {action && (
                <p className="mt-1.5 text-[11.5px] text-muted">{action}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
