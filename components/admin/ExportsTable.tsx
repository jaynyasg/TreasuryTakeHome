"use client";

import { useId, useState } from "react";
import type { ExportRowDTO } from "@/lib/server/adminDto";
import { generateExportAction } from "@/app/(reviewer)/admin/actions";
import Modal from "@/components/house/Modal";
import Button from "@/components/house/Button";
import StatusPill from "./StatusPill";
import {
  exportStatusView,
  exportIsDownloadable,
  formatTimestamp,
  shortId,
} from "./format";

/**
 * Exports list (plan Admin IA: "Exports"). One row per point-in-time export
 * snapshot with status, requester, created time, and an artifact reference. The
 * MAIN surface of the Exports tab.
 *
 * "Generate export" opens a confirmation dialog capturing the batch id + actor +
 * timestamp (no reason required — generate is not a destructive purge/replay),
 * then runs {@link generateExportAction}.
 *
 * Download: a complete/partial export with an object key exposes its artifact
 * reference. Export artifacts are served by object key, not the case-file route
 * (`/api/files/[id]` is keyed by case-file id), so until a dedicated export
 * download route exists the row surfaces the object key as the retrievable
 * reference rather than a misleading dead link — see the "coming soon" note.
 */
export default function ExportsTable({
  rows,
  actor,
}: {
  rows: readonly ExportRowDTO[];
  actor: string;
}) {
  const [generating, setGenerating] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button type="button" onClick={() => setGenerating(true)}>
          Generate export
        </Button>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Point-in-time exports, newest first. {rows.length} exports shown.
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface/60">
              {["Export", "Batch", "Status", "Requested by", "Created", "Artifact"].map(
                (h) => (
                  <th
                    key={h}
                    scope="col"
                    className={
                      "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted " +
                      (h === "Artifact" ? "text-right" : "")
                    }
                  >
                    {h}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const view = exportStatusView(row.status);
              return (
                <tr
                  key={row.id}
                  className="border-b border-line transition last:border-b-0 hover:bg-surface/40"
                >
                  <td className="px-3 py-3 align-top">
                    <span className="font-mono text-[12px] text-ink" title={row.id}>
                      {shortId(row.id)}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="font-mono text-[12px] text-ink-2" title={row.batchId}>
                      {shortId(row.batchId)}
                    </span>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <StatusPill tone={view.tone}>{view.label}</StatusPill>
                  </td>
                  <td className="px-3 py-3 align-top">
                    <span className="font-mono text-[12px] text-ink-2" title={row.requestedBy}>
                      {shortId(row.requestedBy)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 align-top text-[12px] text-ink-2">
                    {formatTimestamp(row.createdAt)}
                  </td>
                  <td className="px-3 py-3 text-right align-top">
                    {exportIsDownloadable(row) ? (
                      <span
                        className="font-mono text-[11px] text-ink-2"
                        title={`Artifact object key: ${row.objectKey}`}
                      >
                        {shortId(row.objectKey, 12, 6)}
                      </span>
                    ) : (
                      <span className="text-[11.5px] text-muted-2">
                        {row.status === "failed" ? "No artifact" : "Pending"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {generating && (
        <GenerateExportDialog actor={actor} onClose={() => setGenerating(false)} />
      )}
    </div>
  );
}

/** Generate-export confirmation: captures the batch id + actor + timestamp. */
function GenerateExportDialog({
  actor,
  onClose,
}: {
  actor: string;
  onClose: () => void;
}) {
  const batchInputId = useId();
  const errorId = useId();
  const [batchId, setBatchId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedAt] = useState(() => new Date());

  const trimmed = batchId.trim();

  async function handleConfirm() {
    if (trimmed.length === 0) {
      setError("Enter the batch id to export.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await generateExportAction({ batchId: trimmed });
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.error ?? "The export could not be generated.");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Modal onClose={pending ? undefined : onClose}>
      <div className="flex w-[28rem] max-w-[80vw] flex-col gap-3 text-ink">
        <div className="flex flex-col gap-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-ink">
            Generate export
          </h2>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="font-medium text-muted">Actor</dt>
            <dd className="truncate text-ink-2" title={actor}>
              {actor}
            </dd>
            <dt className="font-medium text-muted">When</dt>
            <dd className="text-ink-2">
              <time dateTime={openedAt.toISOString()}>
                {openedAt.toISOString().replace("T", " ").slice(0, 16)} UTC
              </time>
            </dd>
          </dl>
          <p className="mt-1 text-[12px] text-muted">
            Generates a point-in-time CSV snapshot including every case in the
            batch (clean, mismatch, failed, and still-processing).
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={batchInputId} className="text-[12px] font-medium text-ink-2">
            Batch id <span className="text-accent-red">(required)</span>
          </label>
          <input
            id={batchInputId}
            value={batchId}
            onChange={(e) => setBatchId(e.target.value)}
            disabled={pending}
            aria-required
            aria-describedby={error ? errorId : undefined}
            placeholder="batch id to export"
            className="w-full rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] text-ink placeholder:text-muted-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          />
          {error && (
            <p id={errorId} role="alert" className="text-[12px] text-accent-red">
              {error}
            </p>
          )}
        </div>

        <div className="mt-1 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="inline-flex min-h-[44px] items-center rounded-lg border border-line bg-card px-3 text-[13px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
          >
            Cancel
          </button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={pending || trimmed.length === 0}
            className="min-h-[44px]"
          >
            {pending ? "Working…" : "Generate"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
