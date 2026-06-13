"use client";

import { useId, useState } from "react";
import type { AssignmentRowDTO } from "@/lib/server/adminDto";
import { reassignAction } from "@/app/(reviewer)/admin/actions";
import Modal from "@/components/house/Modal";
import Button from "@/components/house/Button";
import StatusPill from "./StatusPill";
import { shortId } from "./format";

/**
 * Assignments table (plan Admin IA: "Reassign Batch / Case Ownership"). One row
 * per batch with its current owner, the optimistic-concurrency version, and a
 * case-count workload cue. The MAIN surface of the Assignments tab.
 *
 * Reassign is externally visible, so it opens a confirmation dialog capturing
 * action + new owner + actor + timestamp. Reassign does NOT require a reason
 * (reason is required only for replay + purge — plan "Disposition Interaction
 * Rules"), but it carries the OPTIMISTIC-CONCURRENCY version the admin saw:
 * {@link reassignAction} passes it as `expectedVersion`, and a {@link
 * StaleAssignmentError} maps to an inline stale-view warning so the admin
 * refreshes and retries (plan "Assignment concurrency").
 */

interface ReassignTarget {
  row: AssignmentRowDTO;
}

export default function AssignmentsTable({
  rows,
  actor,
}: {
  rows: readonly AssignmentRowDTO[];
  actor: string;
}) {
  const [target, setTarget] = useState<ReassignTarget | null>(null);

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Batch assignments with current owner and concurrency version.{" "}
          {rows.length} batches shown.
        </caption>
        <thead>
          <tr className="border-b border-line bg-surface/60">
            {["Batch", "Owner", "Cases", "Version", "Action"].map((h) => (
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
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.batchId}
              className="border-b border-line transition last:border-b-0 hover:bg-surface/40"
            >
              <td className="px-3 py-3 align-top">
                <span className="flex flex-col gap-0.5">
                  <span className="text-[13px] font-medium text-ink">
                    {row.batchName}
                  </span>
                  <span className="font-mono text-[11px] text-muted" title={row.batchId}>
                    {shortId(row.batchId)}
                  </span>
                </span>
              </td>
              <td className="px-3 py-3 align-top">
                {row.assignedUserId ? (
                  <span className="font-mono text-[12px] text-ink-2" title={row.assignedUserId}>
                    {shortId(row.assignedUserId)}
                  </span>
                ) : (
                  <StatusPill tone="warn">Unassigned</StatusPill>
                )}
              </td>
              <td className="px-3 py-3 align-top text-[12.5px] text-ink-2">
                {row.caseCount}
              </td>
              <td className="px-3 py-3 align-top">
                <span className="font-mono text-[12px] text-muted">
                  v{row.assignmentVersion}
                </span>
              </td>
              <td className="px-3 py-3 text-right align-top">
                <button
                  type="button"
                  onClick={() => setTarget({ row })}
                  disabled={row.assignmentVersion === 0}
                  title={
                    row.assignmentVersion === 0
                      ? "This batch has no assignment to reassign"
                      : "Reassign this batch to a different owner"
                  }
                  className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Reassign
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {target && (
        <ReassignDialog
          target={target.row}
          actor={actor}
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}

/** Reassign confirmation: captures the new owner + the concurrency version. */
function ReassignDialog({
  target,
  actor,
  onClose,
}: {
  target: AssignmentRowDTO;
  actor: string;
  onClose: () => void;
}) {
  const ownerId = useId();
  const errorId = useId();
  const [userId, setUserId] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openedAt] = useState(() => new Date());

  const trimmed = userId.trim();

  async function handleConfirm() {
    if (trimmed.length === 0) {
      setError("Enter the user id of the new owner.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await reassignAction({
        batchId: target.batchId,
        userId: trimmed,
        expectedVersion: target.assignmentVersion,
      });
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.error ?? "The batch could not be reassigned.");
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
            Reassign batch
          </h2>
          <dl className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[12px]">
            <dt className="font-medium text-muted">Batch</dt>
            <dd className="truncate text-ink-2">
              {target.batchName} ({shortId(target.batchId)})
            </dd>
            <dt className="font-medium text-muted">Current owner</dt>
            <dd className="text-ink-2">
              {target.assignedUserId ? shortId(target.assignedUserId) : "unassigned"} · v{target.assignmentVersion}
            </dd>
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
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={ownerId} className="text-[12px] font-medium text-ink-2">
            New owner user id <span className="text-accent-red">(required)</span>
          </label>
          <input
            id={ownerId}
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={pending}
            aria-required
            aria-describedby={error ? errorId : undefined}
            placeholder="user id of the reviewer to assign"
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
            {pending ? "Working…" : "Reassign"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
