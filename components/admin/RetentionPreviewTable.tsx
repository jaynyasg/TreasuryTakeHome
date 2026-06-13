"use client";

import { useState } from "react";
import type { RetentionPreviewDTO } from "@/lib/server/adminDto";
import {
  previewPurgeAction,
  purgeAction,
  type PurgeEligibleRow,
} from "@/app/(reviewer)/admin/actions";
import ReasonRequiredDialog from "./ReasonRequiredDialog";
import StatusPill from "./StatusPill";
import { formatTimestamp } from "./format";

/**
 * Retention purge two-step flow (plan "Retention purge": phase one preview /
 * counts, phase two approve). The MAIN surface of the Retention tab.
 *
 * Step 1 — PREVIEW: render the purge-eligible counts grouped by aggregate type
 * (from the server `getRetentionPreview`) so the admin reviews scope before
 * approving.
 * Step 2 — APPROVE: "Approve purge" re-reads the concrete eligible retention row
 * ids ({@link previewPurgeAction}) and opens the {@link ReasonRequiredDialog}
 * with `reasonRequired` — a reason note is MANDATORY for purge (plan
 * "Disposition Interaction Rules" — reason-required applies to purge). The
 * dialog runs {@link purgeAction}, which reads the purge KILL SWITCH from env
 * and deletes NOTHING when engaged.
 *
 * After a purge the tombstone/result summary (purged / skipped, or the kill-
 * switch-blocked notice) renders inline. A `killSwitchOn` prop (read from env on
 * the server) disables Approve up front and explains the disabled-by-kill-switch
 * state.
 */

interface PurgeSummary {
  purged: number;
  skipped: number;
  killSwitchOn: boolean;
}

export default function RetentionPreviewTable({
  preview,
  killSwitchOn,
  actor,
}: {
  preview: RetentionPreviewDTO;
  /** Server-read purge kill-switch posture (plan "Operational brakes"). */
  killSwitchOn: boolean;
  /** Signed-in admin label, shown in the confirm dialog's audit envelope. */
  actor: string;
}) {
  const types = Object.keys(preview.eligibleByAggregateType).sort();
  const [approving, setApproving] = useState(false);
  const [loadingIds, setLoadingIds] = useState(false);
  const [eligible, setEligible] = useState<PurgeEligibleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<PurgeSummary | null>(null);

  const nothingEligible = preview.totalEligible === 0;

  async function beginApprove() {
    setError(null);
    setSummary(null);
    setLoadingIds(true);
    try {
      const result = await previewPurgeAction();
      if (!result.ok || !result.eligible) {
        setError(result.error ?? "Could not load the purge-eligible records.");
        return;
      }
      if (result.eligible.length === 0) {
        setError("There are no purge-eligible records right now.");
        return;
      }
      setEligible(result.eligible);
      setApproving(true);
    } finally {
      setLoadingIds(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {killSwitchOn && (
        <div
          role="status"
          className="flex items-center gap-2 rounded-card border border-accent-amber/50 bg-accent-amber/10 px-3 py-2 text-[12.5px] text-ink"
        >
          <StatusPill tone="warn">Purge disabled</StatusPill>
          <span>
            The retention purge kill switch is engaged. Approving a purge will
            delete nothing until it is cleared via ops/env.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
        <span>
          <span className="font-semibold text-ink">{preview.totalEligible}</span>{" "}
          records purge-eligible
        </span>
        <span className="text-muted">
          Oldest eligible: {formatTimestamp(preview.oldestEligibleAt)}
        </span>
      </div>

      <div className="overflow-x-auto rounded-card border border-line bg-card">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Purge-eligible records grouped by aggregate type. {types.length}{" "}
            types, {preview.totalEligible} records total.
          </caption>
          <thead>
            <tr className="border-b border-line bg-surface/60">
              {["Aggregate type", "Eligible records"].map((h) => (
                <th
                  key={h}
                  scope="col"
                  className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {types.map((type) => (
              <tr
                key={type}
                className="border-b border-line last:border-b-0 hover:bg-surface/40"
              >
                <td className="px-3 py-3 text-[13px] text-ink">{type}</td>
                <td className="px-3 py-3 text-[13px] text-ink-2">
                  {preview.eligibleByAggregateType[type]}
                </td>
              </tr>
            ))}
            {nothingEligible && (
              <tr>
                <td colSpan={2} className="px-3 py-6 text-center text-[13px] text-muted">
                  No purge-eligible records. Nothing to approve right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {error && (
        <p role="alert" className="text-[12.5px] text-accent-red">
          {error}
        </p>
      )}

      {summary && (
        <div
          role="status"
          className="rounded-card border border-line bg-surface/40 px-3 py-2 text-[12.5px] text-ink-2"
        >
          {summary.killSwitchOn ? (
            <span>
              Purge blocked by kill switch — {summary.skipped} records skipped, 0
              deleted.
            </span>
          ) : (
            <span>
              Purge complete — {summary.purged} records purged (tombstoned),{" "}
              {summary.skipped} skipped.
            </span>
          )}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={beginApprove}
          disabled={nothingEligible || loadingIds}
          title={
            nothingEligible
              ? "No purge-eligible records to approve"
              : "Review and approve the purge"
          }
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-ink px-3 text-[13px] font-medium text-white transition hover:bg-[#2c2620] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loadingIds ? "Loading…" : "Approve purge"}
        </button>
      </div>

      {approving && eligible && (
        <ReasonRequiredDialog
          action="Approve retention purge"
          actor={actor}
          reasonRequired
          destructive
          confirmLabel="Purge"
          details={
            <span className="flex flex-col gap-0.5">
              <span>{eligible.length} records will be purged (tombstoned).</span>
              {killSwitchOn && (
                <span className="text-accent-amber">
                  Kill switch engaged — this will delete nothing.
                </span>
              )}
            </span>
          }
          onConfirm={async (reason) => {
            const result = await purgeAction({
              ids: eligible.map((e) => e.retentionId),
              reason,
            });
            // A real purge OR a kill-switch-blocked no-op are both COMPLETED
            // outcomes: record the result summary and let the dialog close. The
            // inline summary banner explains the kill-switch block. Only a true
            // error (forbidden, missing reason, DB failure) keeps the dialog open.
            if (result.ok || result.killSwitchOn) {
              setSummary({
                purged: result.purged ?? 0,
                skipped: result.skipped ?? 0,
                killSwitchOn: result.killSwitchOn ?? false,
              });
              return { ok: true };
            }
            return { ok: false, error: result.error };
          }}
          onClose={() => {
            setApproving(false);
            setEligible(null);
          }}
        />
      )}
    </div>
  );
}
