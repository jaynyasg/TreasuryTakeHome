"use client";

import { useId, useState, type ReactNode } from "react";
import Modal from "@/components/house/Modal";
import Button from "@/components/house/Button";

/**
 * Shared confirmation dialog for every destructive / externally-visible admin
 * action (plan "Disposition Interaction Rules": destructive or externally
 * visible actions use a compact confirmation dialog with the action, reason,
 * actor, timestamp; reason is REQUIRED for replay and purge).
 *
 * Captures and surfaces the full audit envelope before the action fires:
 *   - `action`     — what is about to happen (e.g. "Replay dead-letter job"),
 *   - `actor`      — the signed-in admin performing it,
 *   - `timestamp`  — when the confirm is being made (rendered live),
 *   - `reason`     — a justification note, REQUIRED when `reasonRequired`.
 *
 * The dialog never calls the server itself. It validates the reason rule client-
 * side (a fast, friendly gate) then hands the trimmed reason to `onConfirm`,
 * which runs the server action (where the reason rule is RE-enforced as the
 * authoritative check). Server-returned errors render inline; the dialog stays
 * open so the admin can retry without losing context.
 *
 * Accessibility: built on the house `Modal` (focus trap, Escape, return focus).
 * The reason field has a visible `<label>` (placeholders are never the only
 * label), and the submit target is a full-height button (>=44px tall).
 */
export interface ReasonRequiredDialogProps {
  /** Short imperative title, e.g. "Replay dead-letter job". */
  action: string;
  /** Signed-in admin performing the action (audit actor). */
  actor: string;
  /** Optional context lines (e.g. job id, case id) shown above the reason. */
  details?: ReactNode;
  /** When true, an empty/whitespace reason blocks confirm (replay + purge). */
  reasonRequired: boolean;
  /** Emphasis label for the confirm button (e.g. "Replay", "Purge"). */
  confirmLabel: string;
  /** Whether confirm is destructive (purge) — styles the confirm button red. */
  destructive?: boolean;
  /**
   * Run the action. Receives the trimmed reason ("" when not required and left
   * blank). Resolve with `{ ok: true }` to close, or `{ ok: false, error }` to
   * keep the dialog open and show the error.
   */
  onConfirm: (reason: string) => Promise<{ ok: boolean; error?: string }>;
  /** Close without acting. */
  onClose: () => void;
}

export default function ReasonRequiredDialog({
  action,
  actor,
  details,
  reasonRequired,
  confirmLabel,
  destructive = false,
  onConfirm,
  onClose,
}: ReasonRequiredDialogProps) {
  const reasonId = useId();
  const errorId = useId();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stamp the confirmation time once, when the dialog mounts.
  const [openedAt] = useState(() => new Date());

  const trimmed = reason.trim();
  const reasonMissing = reasonRequired && trimmed.length === 0;

  async function handleConfirm() {
    if (reasonMissing) {
      setError("A reason note is required for this action.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await onConfirm(trimmed);
      if (result.ok) {
        onClose();
        return;
      }
      setError(result.error ?? "The action could not be completed.");
    } catch {
      // Keep async errors observable: surface, never swallow silently.
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
            {action}
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
          {details && (
            <div className="mt-1 rounded-lg border border-line/60 bg-card/40 p-2 text-[12px] text-ink-2">
              {details}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={reasonId}
            className="text-[12px] font-medium text-ink-2"
          >
            Reason {reasonRequired ? <span className="text-accent-red">(required)</span> : <span className="text-muted">(optional)</span>}
          </label>
          <textarea
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            disabled={pending}
            aria-required={reasonRequired}
            aria-invalid={reasonMissing && error !== null}
            aria-describedby={error ? errorId : undefined}
            placeholder="Why is this action being taken? (recorded in the audit log)"
            className="w-full resize-y rounded-lg border border-line bg-card px-2.5 py-2 text-[13px] text-ink placeholder:text-muted-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
            disabled={pending || reasonMissing}
            className={
              "min-h-[44px] " +
              (destructive
                ? "bg-accent-red hover:bg-accent-red/90 focus-visible:ring-accent-red/30"
                : "")
            }
          >
            {pending ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
