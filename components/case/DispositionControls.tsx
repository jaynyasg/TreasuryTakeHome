"use client";

import { useState, useTransition, type ReactNode } from "react";
import Button from "@/components/house/Button";
import Modal from "@/components/house/Modal";
import { Check, Spinner, X } from "@/components/house/icons";
import {
  gateAction,
  validateSubmission,
} from "@/components/case/dispositionRules";
import type {
  CaseDetailView,
  DispositionActionKind,
  DispositionResult,
  RecordDispositionAction,
} from "@/components/case/types";

/**
 * Client disposition controls for Case Detail (plan "Disposition Interaction
 * Rules"). Renders the Approve / Reject / Request-better-image action group and
 * enforces the rules at the UI seam via the pure `dispositionRules` helpers —
 * the server action re-enforces them authoritatively, so this layer is about
 * friction, not trust.
 *
 * Destructive / externally-visible actions (reject, request-better-image) and
 * approve-over-concern go through a compact confirmation Modal that restates the
 * action, reason, actor, timestamp, and case id before committing.
 *
 * The machine verdict is ADVISORY; this control records the AUTHORITATIVE human
 * disposition. That framing is stated in the surrounding header copy and echoed
 * in the confirmation dialog.
 */

const REQUEST_CATEGORIES = [
  "Image too blurry / low resolution",
  "Warning region cropped or obscured",
  "Glare or lighting obscures text",
  "Wrong label uploaded",
  "Other (explain below)",
] as const;

interface PendingAction {
  action: DispositionActionKind;
  /** Confirmation only (clean approve) vs. a reason-collecting dialog. */
  needsReason: boolean;
}

const ACTION_LABEL: Record<DispositionActionKind, string> = {
  approve: "Approve",
  reject: "Reject",
  request_better_image: "Request better image",
};

export default function DispositionControls({
  view,
  actorUserId,
  evidenceLoaded,
  /** Server action injected by the page (decouples this client component from
   *  the route-group module path). */
  onRecord,
  /** When true, render as the sticky repeated group after long evidence. */
  sticky = false,
}: {
  view: CaseDetailView;
  actorUserId: string;
  evidenceLoaded: boolean;
  onRecord: RecordDispositionAction;
  sticky?: boolean;
}) {
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [reason, setReason] = useState("");
  const [category, setCategory] = useState<string>(REQUEST_CATEGORIES[0]);
  const [formError, setFormError] = useState<string | null>(null);
  const [result, setResult] = useState<DispositionResult | null>(null);
  const [isPending, startTransition] = useTransition();

  // If a disposition is already recorded (after save or stale), the gate
  // disables everything and we surface the recorded outcome instead.
  const recorded = result?.ok ? result.recorded : view.disposition ?? null;

  function open(action: DispositionActionKind) {
    const gate = gateAction(action, view, { evidenceLoaded });
    if (!gate.enabled) return;
    setReason("");
    setCategory(REQUEST_CATEGORIES[0]);
    setFormError(null);
    setResult(null);
    setPending({ action, needsReason: gate.requiresReason || action !== "approve" });
  }

  function submit() {
    if (!pending) return;
    const { action } = pending;
    const isBetterImage = action === "request_better_image";
    const validationError = validateSubmission(action, view, {
      reason: reason || null,
      category: isBetterImage ? category : null,
    });
    if (validationError) {
      setFormError(validationError);
      return;
    }
    setFormError(null);
    startTransition(async () => {
      const res = await onRecord({
        caseId: view.dto.caseId,
        action,
        reason: reason || null,
        category: isBetterImage ? category : null,
      });
      setResult(res);
      if (res.ok) {
        setPending(null);
      } else {
        setFormError(res.error ?? "Could not record the disposition.");
      }
    });
  }

  // Recorded confirmation replaces the action group once a disposition exists.
  if (recorded) {
    return (
      <RecordedSummary
        action={recorded.action}
        actorUserId={recorded.actorUserId}
        at={recorded.at}
        reason={recorded.reason}
        sticky={sticky}
      />
    );
  }

  const approveGate = gateAction("approve", view, { evidenceLoaded });
  const rejectGate = gateAction("reject", view, { evidenceLoaded });
  const betterGate = gateAction("request_better_image", view, { evidenceLoaded });

  return (
    <div
      className={
        "flex flex-col gap-2 " +
        (sticky
          ? "sticky bottom-0 z-10 border-t border-line bg-card/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-card/80"
          : "")
      }
    >
      {sticky && (
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          Record disposition
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          onClick={() => open("approve")}
          disabled={!approveGate.enabled}
          icon={<Check size={13} />}
          title={approveGate.disabledReason ?? undefined}
          className="bg-accent-green text-white hover:bg-accent-green/90"
        >
          Approve
        </Button>
        <Button
          type="button"
          onClick={() => open("reject")}
          disabled={!rejectGate.enabled}
          icon={<X size={12} />}
          title={rejectGate.disabledReason ?? undefined}
          className="bg-accent-red text-white hover:bg-accent-red/90"
        >
          Reject
        </Button>
        <button
          type="button"
          onClick={() => open("request_better_image")}
          disabled={!betterGate.enabled}
          title={betterGate.disabledReason ?? undefined}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-line bg-card px-3 text-[13px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50"
        >
          Request better image
        </button>
      </div>

      {/* The strictest disabled reason, surfaced as helper text. */}
      {!approveGate.enabled && approveGate.disabledReason && (
        <p className="text-[11.5px] text-muted">{approveGate.disabledReason}</p>
      )}

      {result && !result.ok && (
        <p role="alert" className="text-[12px] text-accent-red">
          {result.error}
        </p>
      )}

      {pending && (
        <Modal onClose={() => (isPending ? undefined : setPending(null))}>
          <div className="w-[min(28rem,90vw)]">
            <h2 className="text-[14px] font-semibold tracking-tight text-ink">
              Confirm: {ACTION_LABEL[pending.action]}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted">
              This is the authoritative human decision and is written to the
              append-only audit log. The machine verdict is advisory.
            </p>

            <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[12px]">
              <dt className="text-muted">Case</dt>
              <dd className="font-mono text-ink-2">{view.dto.caseId}</dd>
              <dt className="text-muted">Actor</dt>
              <dd className="text-ink-2">{actorUserId}</dd>
              <dt className="text-muted">Action</dt>
              <dd className="text-ink-2">{ACTION_LABEL[pending.action]}</dd>
            </dl>

            {pending.action === "request_better_image" && (
              <label className="mt-3 block">
                <span className="text-[11.5px] font-semibold text-ink-2">
                  Reason category
                </span>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-card px-2.5 py-2 text-[12.5px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  {REQUEST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {pending.needsReason && (
              <label className="mt-3 block">
                <span className="text-[11.5px] font-semibold text-ink-2">
                  Reason
                  {pending.action === "approve" ? " (overriding a machine concern)" : ""}
                  {pending.action === "request_better_image" ? " (optional detail)" : ""}
                </span>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder={
                    pending.action === "reject"
                      ? "Explain why this label is rejected (included in the audit record)."
                      : pending.action === "approve"
                        ? "Explain why you are approving over the flagged concern."
                        : "Add detail to help the applicant supply a usable image."
                  }
                  className="mt-1 w-full rounded-lg border border-line bg-card px-2.5 py-2 text-[12.5px] text-ink placeholder:text-muted-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                />
              </label>
            )}

            {(pending.action === "reject" || pending.action === "approve") && (
              <p className="mt-2 text-[11px] text-muted">
                Audit record will include: action, actor, timestamp, case id,
                reason{view.machine?.overall ? ", and the advisory machine verdict" : ""}.
              </p>
            )}

            {formError && (
              <p role="alert" className="mt-2 text-[12px] text-accent-red">
                {formError}
              </p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                disabled={isPending}
                className="inline-flex h-9 items-center rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-ink-2 transition hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              >
                Cancel
              </button>
              <Button
                type="button"
                onClick={submit}
                disabled={isPending}
                icon={isPending ? <Spinner size={12} /> : undefined}
              >
                {isPending ? "Recording…" : `Confirm ${ACTION_LABEL[pending.action].toLowerCase()}`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RecordedSummary({
  action,
  actorUserId,
  at,
  reason,
  sticky,
}: {
  action: DispositionActionKind;
  actorUserId: string;
  at: string;
  reason: string | null;
  sticky: boolean;
}): ReactNode {
  const when = formatTs(at);
  const tone =
    action === "approve"
      ? "border-accent-green/40 bg-accent-green/10"
      : action === "reject"
        ? "border-accent-red/40 bg-accent-red/10"
        : "border-accent-amber/50 bg-accent-amber/10";
  return (
    <div
      className={
        "rounded-lg border px-3 py-2.5 " +
        tone +
        (sticky ? " sticky bottom-0 z-10" : "")
      }
    >
      <div className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
        <span aria-hidden className="text-accent-green">
          <Check size={13} />
        </span>
        Disposition recorded — {ACTION_LABEL[action]}
      </div>
      <p className="mt-1 text-[11.5px] text-ink-2">
        by {actorUserId} · <time dateTime={at}>{when}</time> · included in export
      </p>
      {reason && (
        <p className="mt-1 text-[11.5px] text-muted">Reason: {reason}</p>
      )}
    </div>
  );
}

function formatTs(at: string): string {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  return d.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}
