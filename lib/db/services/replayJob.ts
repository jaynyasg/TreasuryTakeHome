import { randomUUID } from "node:crypto";
import type { DbClient, Queryable } from "@/lib/db/client";
import type { QueueAdapter } from "@/lib/adapters/queue/types";
import type { CaseState } from "@/lib/core/state/case";

import { getCase, setCaseStatus } from "@/lib/db/repositories/cases";
import {
  startAttempt,
  countAttempts,
} from "@/lib/db/repositories/processingAttempts";
import { appendAuditEvent } from "@/lib/db/repositories/auditEvents";
import type { CaseJobPayload } from "@/worker/processCase";

/** Queue job type the worker routes case processing on (matches startBatch). */
const CASE_JOB_TYPE = "case.process";

/** Case states from which an admin replay is eligible — the dead-letter /
 *  failed family (plan "Poison jobs": replay after repair). A clean/scored or
 *  in-flight case is NOT replayable. */
const REPLAYABLE_STATES: ReadonlySet<CaseState> = new Set<CaseState>([
  "dead_letter",
  "failed",
  "needs_better_image",
]);

/** Arguments to {@link replayDeadLetter}. */
export interface ReplayDeadLetterArgs {
  /** Case to replay. */
  caseId: string;
  /** The dead-lettered job id this replay is repairing (recorded in audit). */
  jobId: string;
  /** Admin performing the replay (recorded on the new attempt + audit). */
  actorUserId: string;
  /** Required justification; replay is rejected before any write without it. */
  reason: string;
  /** Trace id propagated into the new attempt + audit event. */
  traceId?: string | null;
}

/** Result of a replay attempt. */
export interface ReplayDeadLetterResult {
  replayed: boolean;
  /** Populated when `replayed` is false: why it was rejected. */
  reason?: string;
}

/** Thrown BEFORE any write when an admin replay arrives without a reason note
 *  (plan "Admin replay controls": replay requires a reason note). */
export class MissingReasonError extends Error {
  constructor() {
    super("A reason note is required to replay a dead-letter job.");
    this.name = "MissingReasonError";
  }
}

/** Thrown when the case does not exist — there is nothing to replay. */
export class CaseNotFoundError extends Error {
  readonly caseId: string;
  constructor(caseId: string) {
    super(`Cannot replay: case not found: ${caseId}`);
    this.name = "CaseNotFoundError";
    this.caseId = caseId;
  }
}

/**
 * Service-command: GUARDED admin replay of a dead-lettered/failed case (plan
 * "Admin replay controls" + "Poison jobs": "Admins can replay after repair, and
 * affected cases remain visible... Replay never overwrites prior evidence in
 * place").
 *
 * Guard order (all BEFORE any state-changing write):
 *   1. **Reason required.** An empty/whitespace reason throws
 *      {@link MissingReasonError} before anything is written.
 *   2. **Case exists.** A missing case throws {@link CaseNotFoundError}.
 *   3. **Eligibility.** The case must be in the dead-letter/failed family;
 *      anything else (clean_match, scoring, etc.) is rejected with
 *      `{ replayed: false, reason }` and writes nothing.
 *
 * On success, in ONE transaction it:
 *   - starts a NEW append-only `processing_attempt` (extracting stage). Prior
 *     attempts/evidence are untouched — replay APPENDS, never overwrites.
 *   - transitions the case back to `queued` via the guarded state machine
 *     (`setCaseStatus` asserts the transition), and
 *   - appends an audit event with actor, reason, and before/after status.
 * Then it re-enqueues a fresh case job AFTER commit with a NEW idempotency key
 * (`${caseId}:replay:${attemptNo}`) so the queue does NOT dedupe it against the
 * original job (plan: idempotencyKey must be new per replay).
 */
export async function replayDeadLetter(
  db: DbClient,
  queue: QueueAdapter,
  args: ReplayDeadLetterArgs
): Promise<ReplayDeadLetterResult> {
  // Guard 1: reason required — throw before any write.
  const reason = args.reason?.trim();
  if (!reason) throw new MissingReasonError();

  // Guard 2: case must exist.
  const before = await getCase(db, args.caseId);
  if (!before) throw new CaseNotFoundError(args.caseId);

  // Guard 3: eligibility — only the dead-letter/failed family is replayable.
  if (!REPLAYABLE_STATES.has(before.status)) {
    return {
      replayed: false,
      reason: `case '${args.caseId}' in state '${before.status}' is not replay-eligible`,
    };
  }

  const traceId = args.traceId ?? null;

  // Append a NEW attempt + transition the case + audit, in one unit of work.
  // The new attempt's number is captured for the queue idempotency key so the
  // re-enqueue is unique per replay.
  const { idempotencyKey } = await db.transaction(async (tx) => {
    // Append-only: a fresh attempt one past the current max for (case, stage).
    // Prior attempts/evidence are never mutated.
    const attempt = await startAttempt(tx, {
      id: randomUUID(),
      caseId: args.caseId,
      stage: "extracting",
      traceId,
    });

    // Guarded transition back to queued so the worker can re-claim the case.
    const updated = await setCaseStatus(tx, args.caseId, "queued");
    if (!updated) throw new CaseNotFoundError(args.caseId);

    // Total attempts so far makes the replay key unique even across stages.
    const total = await totalAttempts(tx, args.caseId);

    await appendAuditEvent(tx, {
      id: randomUUID(),
      actorUserId: args.actorUserId,
      action: "replay.dead_letter",
      aggregateType: "case",
      aggregateId: args.caseId,
      beforeSummary: { status: before.status, jobId: args.jobId },
      afterSummary: { status: updated.status, attemptNo: attempt.attempt_no },
      reason,
      traceId,
    });

    return { idempotencyKey: `${args.caseId}:replay:${total}` };
  });

  // Re-enqueue AFTER commit so a rollback never leaves an orphaned job. The NEW
  // idempotency key prevents the queue from deduping against the original job.
  const payload: CaseJobPayload = {
    caseId: args.caseId,
    ...(traceId ? { traceId } : {}),
  };
  await queue.enqueue({
    id: randomUUID(),
    type: CASE_JOB_TYPE,
    payload,
    idempotencyKey,
  });

  return { replayed: true };
}

// --- helpers ---------------------------------------------------------------

/** Total attempts across all stages for a case — drives the unique replay key. */
async function totalAttempts(db: Queryable, caseId: string): Promise<number> {
  return (
    (await countAttempts(db, caseId, "extracting")) +
    (await countAttempts(db, caseId, "scoring"))
  );
}
