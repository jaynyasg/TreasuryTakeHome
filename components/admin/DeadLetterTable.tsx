"use client";

import { useState, type ReactNode } from "react";
import type { DeadLetterRowDTO } from "@/lib/server/adminDto";
import { replayAction } from "@/app/(reviewer)/admin/actions";
import ReasonRequiredDialog from "./ReasonRequiredDialog";
import StatusPill from "./StatusPill";
import { formatTimestamp, shortId } from "./format";

/**
 * Dead-letter / failed jobs table (plan Admin IA: "Failed / Dead-letter Jobs").
 * The MAIN surface of the Failed tab — the operational table carries the work
 * (Anti-Generic UI Constraints). One row per parked poison job with its attempt
 * count + preserved failure reason, and a per-row "Replay" action.
 *
 * Replay is destructive/external: it opens the {@link ReasonRequiredDialog} with
 * `reasonRequired` so a reason note is mandatory (plan "Disposition Interaction
 * Rules" — reason-required applies to replay). The dialog runs {@link
 * replayAction}, which RE-enforces the reason rule server-side and re-enqueues
 * with a fresh idempotency key.
 *
 * A job with no owning case id cannot be replayed (replay targets a case); that
 * row shows a disabled action with an explanatory title. Accessibility: a real
 * `<table>` with a caption + scoped headers, stable rows, and 44px action
 * targets.
 */
export default function DeadLetterTable({
  rows,
  actor,
}: {
  rows: readonly DeadLetterRowDTO[];
  /** Signed-in admin label, shown in the confirm dialog's audit envelope. */
  actor: string;
}) {
  const [target, setTarget] = useState<DeadLetterRowDTO | null>(null);

  // Build the replay dialog where `caseId` narrows to a non-null string in a
  // straight-line block (closure-captured state would otherwise re-widen it).
  let replayDialog: ReactNode = null;
  if (target && target.caseId !== null) {
    const caseId = target.caseId;
    const jobId = target.jobId;
    replayDialog = (
      <ReasonRequiredDialog
        action="Replay dead-letter job"
        actor={actor}
        reasonRequired
        confirmLabel="Replay"
        details={
          <span className="flex flex-col gap-0.5">
            <span>
              Job {shortId(jobId)} · {target.type}
            </span>
            <span>
              Case {shortId(caseId)} · {target.attempts} attempts
            </span>
          </span>
        }
        onConfirm={(reason) => replayAction({ caseId, jobId, reason })}
        onClose={() => setTarget(null)}
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Dead-letter jobs parked for admin replay, newest first. {rows.length}{" "}
          jobs shown.
        </caption>
        <thead>
          <tr className="border-b border-line bg-surface/60">
            {["Job", "Case", "Attempts", "Reason", "Last activity", "Action"].map(
              (h) => (
                <th
                  key={h}
                  scope="col"
                  className={
                    "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted " +
                    (h === "Action" ? "text-right" : "")
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
            const replayable = row.caseId !== null;
            return (
              <tr
                key={row.jobId}
                className="border-b border-line transition last:border-b-0 hover:bg-surface/40"
              >
                <td className="px-3 py-3 align-top">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-mono text-[12px] text-ink" title={row.jobId}>
                      {shortId(row.jobId)}
                    </span>
                    <span className="text-[11px] text-muted">{row.type}</span>
                  </span>
                </td>
                <td className="px-3 py-3 align-top">
                  <span className="font-mono text-[12px] text-ink-2" title={row.caseId ?? undefined}>
                    {row.caseId ? shortId(row.caseId) : "—"}
                  </span>
                </td>
                <td className="px-3 py-3 align-top">
                  <StatusPill tone="alert">{row.attempts}</StatusPill>
                </td>
                <td className="max-w-[24rem] px-3 py-3 align-top">
                  <span
                    className="block overflow-hidden text-[12.5px] leading-snug text-ink-2 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
                    title={row.reason ?? undefined}
                  >
                    {row.reason ?? "No reason recorded"}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3 align-top text-[12px] text-ink-2">
                  {formatTimestamp(row.lastAt)}
                </td>
                <td className="px-3 py-3 text-right align-top">
                  <button
                    type="button"
                    onClick={() => replayable && setTarget(row)}
                    disabled={!replayable}
                    title={
                      replayable
                        ? "Replay this dead-letter job"
                        : "Cannot replay: job has no owning case"
                    }
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Replay
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {replayDialog}
    </div>
  );
}
