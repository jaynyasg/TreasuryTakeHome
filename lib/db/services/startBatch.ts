import { randomUUID } from "node:crypto";
import type { DbClient, Queryable } from "@/lib/db/client";
import type { QueueAdapter } from "@/lib/adapters/queue/types";
import type { ColaApplication } from "@/lib/contract";

import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase, setCaseStatus } from "@/lib/db/repositories/cases";
import { insertCaseFile } from "@/lib/db/repositories/caseFiles";
import { insertExtractedFields } from "@/lib/db/repositories/extractedFields";
import { appendAuditEvent } from "@/lib/db/repositories/auditEvents";
import {
  getIntakeSession,
  listManifestEntries,
  setIntakeStatus,
  setIntakeBatchId,
  type IntakeSessionRow,
  type IntakeStatus,
  type ManifestEntryRow,
} from "@/lib/db/repositories/intake";
import { pairCases } from "@/lib/intake/pairing";
import type { ManifestEntry } from "@/lib/intake/types";
import { applicationToFields } from "@/worker/application";
import { CaseJobPayload } from "@/worker/processCase";

/** Provider/storage tag stamped on every case_file object-manifest row. */
const OBJECT_PROVIDER = "vercel-blob";
/** Queue job type the worker routes on (matches the worker stage). */
const CASE_JOB_TYPE = "case.process";

/** Arguments to {@link startBatch}. */
export interface StartBatchArgs {
  intakeSessionId: string;
  /** Owner of the created batch (the reviewer/admin who started it). */
  ownerUserId: string;
  /**
   * Per-case application data, keyed by caseKey. When a complete case's key is
   * present here, its application fields are persisted as `application.*`
   * extracted_fields (via {@link applicationToFields}) so the worker can
   * reconstruct the ColaApplication. Cases without supplied application data
   * still get created + enqueued; the worker finalizes them `failed` if the
   * application is unavailable at scoring time.
   */
  applications?: Record<string, ColaApplication>;
  /** Trace id propagated into each enqueued job payload + audit events. */
  traceId?: string | null;
}

/** Result of starting (or no-op re-running) a batch. */
export interface StartBatchResult {
  batchId: string;
  caseCount: number;
}

/** Raised when the referenced intake session does not exist. */
export class IntakeSessionNotFoundError extends Error {
  constructor(intakeSessionId: string) {
    super(`Intake session not found: ${intakeSessionId}`);
    this.name = "IntakeSessionNotFoundError";
  }
}

/**
 * Service-command: turn a reviewed intake session into a durable batch of
 * queued cases — exactly once (plan T4; "Idempotent intake": "a single allowed
 * transition into processing so refresh/retry/double-submit cannot enqueue
 * duplicate batches").
 *
 * Idempotency has two independent guards:
 *   1. **Session status.** If the session is already `processing` this is a
 *      replayed submit: we return its existing batch with the live case count
 *      and do NOT open a transaction, create a second batch, or re-enqueue.
 *   2. **Queue idempotency key.** Each case job is enqueued with
 *      `idempotencyKey = caseId`; even if a job were enqueued twice, the queue
 *      adapter no-ops the duplicate (plan "Idempotent intake" at the queue seam).
 *
 * The first successful run, inside ONE transaction, creates the batch
 * (status `processing`), one case per COMPLETE manifest pair (transitioned
 * draft → queued so the worker can claim it), persists each case's application
 * fields + its two object-manifest `case_files` rows, links + transitions the
 * session to `processing`, and appends an audit event. Jobs are enqueued AFTER
 * the transaction commits, so a transaction rollback never leaves orphaned jobs.
 */
export async function startBatch(
  db: DbClient,
  queue: QueueAdapter,
  args: StartBatchArgs
): Promise<StartBatchResult> {
  // Guard 1 (pre-transaction): a session already in `processing` is a replay.
  const existing = await getIntakeSession(db, args.intakeSessionId);
  if (!existing) throw new IntakeSessionNotFoundError(args.intakeSessionId);

  if (existing.status === "processing") {
    return noopExistingBatch(db, existing);
  }

  const traceId = args.traceId ?? null;

  // First run: build the batch + cases + manifest in one unit of work, then
  // collect the case ids to enqueue once the transaction has committed.
  const { batchId, caseIds } = await db.transaction(async (tx) => {
    // Re-read inside the transaction to narrow a concurrent double-start: if a
    // racing call already moved the session to processing, treat as a no-op.
    const session = await getIntakeSession(tx, args.intakeSessionId);
    if (!session) throw new IntakeSessionNotFoundError(args.intakeSessionId);
    if (session.status === "processing") {
      return { batchId: null as string | null, caseIds: [] as string[] };
    }

    const newBatchId = randomUUID();
    await insertBatch(tx, {
      id: newBatchId,
      ownerUserId: args.ownerUserId,
      status: "processing",
      intakeSessionId: session.id,
      manifestHash: session.manifest_hash,
    });

    const entries = await listManifestEntries(tx, session.id);
    const cases = pairCases(entries.map(rowToManifestEntry));

    const createdCaseIds: string[] = [];
    for (const paired of cases) {
      if (!paired.complete || !paired.application || !paired.label) continue;

      const caseId = randomUUID();
      await insertCase(tx, {
        id: caseId,
        batchId: newBatchId,
        brand: args.applications?.[paired.caseKey]?.brandName ?? null,
        classType: args.applications?.[paired.caseKey]?.classType ?? null,
        applicant:
          args.applications?.[paired.caseKey]?.applicantNameAddress ?? null,
      });

      // Persist the application's matchable fields as `application.*` so the
      // worker can reconstruct the ColaApplication (worker/application.ts).
      const application = args.applications?.[paired.caseKey];
      if (application) {
        await insertExtractedFields(
          tx,
          caseId,
          applicationToFields(application, () => randomUUID())
        );
      }

      // Object-manifest rows for the paired files (manifest is source of truth).
      await insertCaseFileFromManifest(tx, caseId, "application", paired.application);
      await insertCaseFileFromManifest(tx, caseId, "label", paired.label);

      // draft -> queued so the worker may claim it.
      await setCaseStatus(tx, caseId, "queued");
      createdCaseIds.push(caseId);
    }

    // Link + advance the session to processing (single transition into
    // processing). Walk the forward-only lifecycle to its end.
    await setIntakeBatchId(tx, session.id, newBatchId);
    await advanceSessionToProcessing(tx, session);

    await appendAuditEvent(tx, {
      id: randomUUID(),
      actorUserId: args.ownerUserId,
      action: "intake.start_batch",
      aggregateType: "batch",
      aggregateId: newBatchId,
      afterSummary: { caseCount: createdCaseIds.length, intakeSessionId: session.id },
      traceId,
    });

    return { batchId: newBatchId, caseIds: createdCaseIds };
  });

  // A racing call won the transaction's processing check: fall back to no-op.
  if (!batchId) {
    const session = await getIntakeSession(db, args.intakeSessionId);
    if (session) return noopExistingBatch(db, session);
    throw new IntakeSessionNotFoundError(args.intakeSessionId);
  }

  // Enqueue one job per case AFTER commit. idempotencyKey = caseId makes a
  // re-enqueue a queue-level no-op.
  for (const caseId of caseIds) {
    const payload: CaseJobPayload = {
      caseId,
      ...(traceId ? { traceId } : {}),
    };
    await queue.enqueue({
      id: randomUUID(),
      type: CASE_JOB_TYPE,
      payload,
      idempotencyKey: caseId,
    });
  }

  return { batchId, caseCount: caseIds.length };
}

// --- helpers ---------------------------------------------------------------

/**
 * No-op result for an already-`processing` session: return its existing batch
 * id and the live count of cases under it, without creating or enqueuing
 * anything.
 */
async function noopExistingBatch(
  db: Queryable,
  session: IntakeSessionRow
): Promise<StartBatchResult> {
  const batchId = session.batch_id;
  if (!batchId) {
    // A processing session must have a batch; treat a missing one as an error
    // rather than silently inventing a batch.
    throw new Error(
      `Intake session ${session.id} is processing but has no batch_id.`
    );
  }
  const { rows } = await db.query<{ count: string }>(
    "select count(*)::text as count from cases where batch_id = $1",
    [batchId]
  );
  const caseCount = Number(rows[0]?.count ?? "0");
  return { batchId, caseCount };
}

/** Map a stored manifest_entries row to the domain ManifestEntry shape. */
function rowToManifestEntry(row: ManifestEntryRow): ManifestEntry {
  return {
    fileName: row.file_name,
    kind: row.kind,
    caseKey: row.case_key,
    checksum: row.checksum ?? "",
    size: row.size_bytes ?? 0,
    contentType: row.content_type ?? "",
    status: row.status,
  };
}

/** Insert one case_file object-manifest row from a paired manifest entry. */
async function insertCaseFileFromManifest(
  tx: Queryable,
  caseId: string,
  kind: "application" | "label",
  entry: ManifestEntry
): Promise<void> {
  await insertCaseFile(tx, {
    id: randomUUID(),
    caseId,
    kind,
    objectProvider: OBJECT_PROVIDER,
    // Object key mirrors the intake upload key (intake/{sessionId}/{fileName});
    // the manifest stores the file name, the upload route stores the bytes.
    objectKey: entry.fileName,
    checksum: entry.checksum || null,
    sizeBytes: entry.size || null,
    contentType: entry.contentType || null,
  });
}

/**
 * Advance a session's forward-only lifecycle to `processing`, applying only the
 * steps still needed (draft → preflighting → ready → processing). Each hop is
 * guarded by {@link setIntakeStatus}, so the terminal state is always reached
 * through legal transitions.
 */
async function advanceSessionToProcessing(
  tx: Queryable,
  session: IntakeSessionRow
): Promise<void> {
  const path: IntakeStatus[] = ["preflighting", "ready", "processing"];
  const order: IntakeStatus[] = ["draft", "preflighting", "ready", "processing"];
  const startIndex = order.indexOf(session.status);
  for (const next of path) {
    if (order.indexOf(next) <= startIndex) continue; // already at/past this step
    await setIntakeStatus(tx, session.id, next);
  }
}
