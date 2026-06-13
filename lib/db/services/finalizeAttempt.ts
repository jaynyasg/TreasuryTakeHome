import type { CaseState } from "@/lib/core/state/case";
import type { DbClient } from "@/lib/db/client";
import { getCase, setCaseStatus } from "@/lib/db/repositories/cases";
import { appendAuditEvent } from "@/lib/db/repositories/auditEvents";
import {
  completeAttempt,
  type AttemptState,
  type CompleteAttemptInput,
  type ProcessingAttemptRow,
} from "@/lib/db/repositories/processingAttempts";

/**
 * Arguments for {@link finalizeAttempt}. The caller decides the scoring outcome
 * and supplies `targetCaseState`; the state machine still guards the move.
 */
export interface FinalizeAttemptArgs {
  /** The in-flight processing attempt to close out. */
  attemptId: string;
  /** The case the attempt belongs to. */
  caseId: string;
  /** Terminal state to write on the attempt. */
  attemptState: AttemptState;
  /** Optional error / backoff fields for the attempt outcome. */
  errorClass?: string | null;
  errorDetail?: string | null;
  nextAttemptAt?: string | null;
  /** State to move the case to (guarded by the case state machine). */
  targetCaseState: CaseState;
  /** Id minted by the caller for the audit event row. */
  auditEventId: string;
  /** Actor / trace metadata for the audit trail. */
  actorUserId?: string | null;
  traceId?: string | null;
  reason?: string | null;
}

/** What the service committed, returned for the caller's convenience. */
export interface FinalizeAttemptResult {
  attempt: ProcessingAttemptRow;
  caseStatus: CaseState;
}

/**
 * Service-command: close out a processing attempt and advance its case in a
 * SINGLE transaction (plan: "service-command owns transaction; repositories
 * accept tx context; state change + audit commit together").
 *
 * In one unit of work it:
 *   1. marks the attempt complete (append-only outcome),
 *   2. transitions the case via the state machine (`setCaseStatus` throws on an
 *      invalid transition, which rolls the whole transaction back), and
 *   3. appends an audit event recording the before/after status.
 *
 * Repositories receive the transaction-bound `tx` so all three writes commit or
 * roll back together. An invalid transition leaves NO partial writes.
 */
export async function finalizeAttempt(
  db: DbClient,
  args: FinalizeAttemptArgs
): Promise<FinalizeAttemptResult> {
  return db.transaction(async (tx) => {
    const before = await getCase(tx, args.caseId);
    if (!before) {
      throw new Error(`finalizeAttempt: case not found: ${args.caseId}`);
    }

    const outcome: CompleteAttemptInput = {
      state: args.attemptState,
      errorClass: args.errorClass ?? null,
      errorDetail: args.errorDetail ?? null,
      nextAttemptAt: args.nextAttemptAt ?? null,
    };
    const attempt = await completeAttempt(tx, args.attemptId, outcome);
    if (!attempt) {
      throw new Error(
        `finalizeAttempt: attempt not found: ${args.attemptId}`
      );
    }

    // Guarded by the case state machine: an invalid transition throws here and
    // rolls back the attempt update + prevents the audit insert below.
    const updated = await setCaseStatus(tx, args.caseId, args.targetCaseState);
    if (!updated) {
      throw new Error(`finalizeAttempt: case not found: ${args.caseId}`);
    }

    await appendAuditEvent(tx, {
      id: args.auditEventId,
      actorUserId: args.actorUserId ?? null,
      action: "finalize_attempt",
      aggregateType: "case",
      aggregateId: args.caseId,
      beforeSummary: { status: before.status, attemptId: args.attemptId },
      afterSummary: {
        status: updated.status,
        attemptId: args.attemptId,
        attemptState: attempt.state,
      },
      reason: args.reason ?? null,
      traceId: args.traceId ?? null,
    });

    return { attempt, caseStatus: updated.status };
  });
}
