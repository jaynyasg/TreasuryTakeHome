import type { DbClient } from "@/lib/db/client";
import {
  insertDisposition,
  type DispositionAction,
  type DispositionRow,
} from "@/lib/db/repositories/dispositions";
import { setCaseStatus, type CaseRow } from "@/lib/db/repositories/cases";
import {
  appendAuditEvent,
  type AuditEventRow,
} from "@/lib/db/repositories/auditEvents";

/** Arguments to {@link recordDisposition}. */
export interface RecordDispositionArgs {
  /** Id for the new disposition row. */
  dispositionId: string;
  /** Id for the audit event appended alongside it. */
  auditEventId: string;
  /** Case being dispositioned. */
  caseId: string;
  /** Reviewer performing the action. */
  actorUserId: string;
  /** Disposition action. */
  action: DispositionAction;
  /** Required for `reject` / `request_better_image`; optional for `approve`. */
  reason?: string | null;
}

/** Result of a successful disposition: the three rows committed together. */
export interface RecordDispositionResult {
  disposition: DispositionRow;
  case: CaseRow;
  auditEvent: AuditEventRow;
}

/** Actions that cannot be recorded without a justification (plan: a reject or
 *  "request better image" must tell the applicant why). */
const REASON_REQUIRED: ReadonlySet<DispositionAction> = new Set([
  "reject",
  "request_better_image",
]);

/** Thrown before any write when a reason-requiring action arrives without one. */
export class MissingReasonError extends Error {
  readonly action: DispositionAction;

  constructor(action: DispositionAction) {
    super(`A reason is required to record a '${action}' disposition.`);
    this.name = "MissingReasonError";
    this.action = action;
  }
}

/**
 * Service-command: record an agent's disposition on a case as one atomic unit
 * of work (plan: "Transaction ownership"). In a single transaction it
 *   1. inserts the disposition row,
 *   2. transitions the case to `disposition_recorded` (guarded by the case
 *      state machine via `setCaseStatus`), and
 *   3. appends an audit event.
 *
 * `reject` and `request_better_image` require a non-empty `reason`; that is
 * enforced BEFORE the transaction opens, so a missing reason writes nothing.
 * Any failure inside the transaction (e.g. an illegal state transition, or an
 * unknown case) rolls back all three writes.
 */
export async function recordDisposition(
  db: DbClient,
  args: RecordDispositionArgs
): Promise<RecordDispositionResult> {
  const reason = args.reason?.trim() ? args.reason : null;

  if (REASON_REQUIRED.has(args.action) && !reason) {
    throw new MissingReasonError(args.action);
  }

  return db.transaction(async (tx) => {
    const disposition = await insertDisposition(tx, {
      id: args.dispositionId,
      caseId: args.caseId,
      actorUserId: args.actorUserId,
      action: args.action,
      reason,
    });

    const updatedCase = await setCaseStatus(
      tx,
      args.caseId,
      "disposition_recorded"
    );
    if (!updatedCase) {
      // Unknown case id: fail the whole unit of work so nothing commits.
      throw new Error(`Cannot record disposition: case ${args.caseId} not found.`);
    }

    const auditEvent = await appendAuditEvent(tx, {
      id: args.auditEventId,
      actorUserId: args.actorUserId,
      action: `disposition.${args.action}`,
      aggregateType: "case",
      aggregateId: args.caseId,
      reason,
    });

    return { disposition, case: updatedCase, auditEvent };
  });
}
