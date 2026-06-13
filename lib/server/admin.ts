import { createPgPool } from "@/lib/db/pg";
import type { DbClient, Queryable } from "@/lib/db/client";
import type { Principal } from "@/lib/auth/authorize";
import type { QueueAdapter, QueueStats } from "@/lib/adapters/queue/types";
import { createPostgresOutboxQueue } from "@/lib/adapters/queue/postgresOutbox";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import { NotAuthorizedError } from "@/lib/server/queries";
import type {
  OpsHealthDTO,
  DeadLetterRowDTO,
  AssignmentRowDTO,
  ExportRowDTO,
  RetentionPreviewDTO,
  ReconciliationRowDTO,
} from "@/lib/server/adminDto";

/**
 * Admin-only Operations Console server data layer (Stage 8 / T8).
 *
 * Reads against the real Postgres database at runtime and returns ONLY the
 * view-safe DTOs in `lib/server/adminDto.ts` — raw rows, queue internals, and
 * storage listings never leave this module. Each entry point:
 *   - calls {@link requireAdmin} FIRST, which throws `NotAuthorizedError` for any
 *     non-admin principal (reviewers are rejected at the seam — admin reads are
 *     broad but ADMIN-ONLY, mirroring the authorization model where assign /
 *     replay / purge and the ops surface belong to admins),
 *   - opens its own pg pool and closes it in a `finally`,
 *   - composes the queue adapter for queue stats where needed.
 *
 * This is an INTEGRATION layer: typecheck/lint clean but not run by
 * `npm run verify` (no live DB there). The pure, unit-tested nucleus lives in
 * `lib/view/admin.ts`.
 *
 * ADMIN-ONLY gating: unlike `lib/server/queries.ts` (reviewer-scoped, per-batch
 * authorization), every function here is gated by role alone — there is no
 * reviewer-visible Operations Console. A reviewer principal never reaches a DB
 * read; `requireAdmin` throws before any query runs.
 */

/**
 * Reject any non-admin principal. Admin reads on the Operations Console are
 * broad (system-wide health, every batch's assignments/exports, all dead-letter
 * jobs) and therefore admin-only by construction. Throws {@link
 * NotAuthorizedError} so the caller maps it to a 403 / forbidden UI exactly like
 * the reviewer query layer.
 */
export function requireAdmin(principal: Principal): void {
  if (principal.role !== "admin") {
    throw new NotAuthorizedError(
      `ops:${principal.userId}`,
      `Operations Console is admin-only; ${principal.role} may not access it`
    );
  }
}

/** Status families used to tally case-level health counts. */
const RETRYING_STATES = ["retry_wait"] as const;
const FAILED_STATES = ["failed", "dead_letter"] as const;

/**
 * Injectable dependencies for {@link getOpsHealth}. The worker heartbeat has no
 * Postgres repository yet (`worker/health.ts` keeps it in-process), so the
 * caller supplies a reader; tests/callers can inject a fake. `estimatedSpendUsd`
 * is likewise sourced from a metrics provider, defaulting to 0 when unwired.
 */
export interface OpsHealthDeps {
  /** Resolve the worker's last heartbeat as an ISO-8601 string, or null. */
  readWorkerHeartbeatAt?: () => Promise<string | null>;
  /** Resolve estimated model spend (USD) for the surfaced window. */
  readEstimatedSpendUsd?: () => Promise<number>;
  /**
   * Build the queue adapter from the DbClient. Defaults to the Postgres outbox
   * (the durable fallback provider); injectable for the live Vercel Queues
   * adapter or a fake.
   */
  makeQueue?: (db: DbClient) => QueueAdapter;
}

/**
 * Product health metrics for the Ops Health tab (plan: "Product health
 * metrics"). Queue depth / oldest-job-age / in-flight / dead-letter come from
 * the queue adapter + `queue_jobs`; case counts come from `cases`; export
 * failures from `exports`; retention overdue from `retention_state`. Heartbeat
 * and spend come from injected deps.
 */
export async function getOpsHealth(
  principal: Principal,
  deps: OpsHealthDeps = {}
): Promise<OpsHealthDTO> {
  requireAdmin(principal);
  const db = createPgPool();
  try {
    const makeQueue = deps.makeQueue ?? createPostgresOutboxQueue;
    const queue = makeQueue(db);

    const [stats, oldestJobAgeSeconds, caseCounts, exportFailureCount, retentionOverdueCount] =
      await Promise.all([
        queue.stats(),
        readOldestJobAgeSeconds(db),
        readCaseHealthCounts(db),
        readExportFailureCount(db),
        readRetentionOverdueCount(db),
      ]);

    const workerLastHeartbeatAt = deps.readWorkerHeartbeatAt
      ? await deps.readWorkerHeartbeatAt()
      : null;
    const estimatedSpendUsd = deps.readEstimatedSpendUsd
      ? await deps.readEstimatedSpendUsd()
      : 0;

    return buildOpsHealth({
      stats,
      oldestJobAgeSeconds,
      caseCounts,
      exportFailureCount,
      retentionOverdueCount,
      workerLastHeartbeatAt,
      estimatedSpendUsd,
    });
  } finally {
    await db.close();
  }
}

/**
 * Dead-letter / failed jobs for the "Failed / Dead-letter Jobs" tab. Reads the
 * parked poison jobs from `queue_jobs`, newest first. The case id is best-effort
 * derived from the job payload (`payload.caseId`), parsed-or-null at the seam.
 */
export async function listDeadLetters(
  principal: Principal
): Promise<DeadLetterRowDTO[]> {
  requireAdmin(principal);
  const db = createPgPool();
  try {
    const res = await db.query<DeadLetterJobRow>(
      `select id, type, payload, attempts, dead_letter_reason, created_at
         from queue_jobs
        where state = 'dead_letter'
        order by created_at desc`
    );
    return res.rows.map(toDeadLetterRow);
  } finally {
    await db.close();
  }
}

/**
 * Assignment rows for the Assignments tab. One row per batch with its current
 * assignment (left-joined — unassigned batches show `assignedUserId: null`),
 * the optimistic-concurrency version, and a case-count workload cue.
 */
export async function listAssignments(
  principal: Principal
): Promise<AssignmentRowDTO[]> {
  requireAdmin(principal);
  const db = createPgPool();
  try {
    const res = await db.query<AssignmentJoinRow>(
      `select
          b.id   as batch_id,
          b.name as batch_name,
          a.user_id as assigned_user_id,
          coalesce(a.assignment_version, 0) as assignment_version,
          (select count(*)::int from cases c where c.batch_id = b.id) as case_count
        from batches b
        left join assignments a on a.batch_id = b.id
        order by b.created_at desc`
    );
    return res.rows.map(toAssignmentRow);
  } finally {
    await db.close();
  }
}

/**
 * Export rows for the Exports tab. When `batchId` is given, scopes to one
 * batch; otherwise lists every export newest-first.
 */
export async function listExports(
  principal: Principal,
  batchId?: string
): Promise<ExportRowDTO[]> {
  requireAdmin(principal);
  const db = createPgPool();
  try {
    const res = batchId
      ? await db.query<ExportProjection>(
          `select id, batch_id, status, object_key, created_at, requested_by
             from exports
            where batch_id = $1
            order by created_at desc`,
          [batchId]
        )
      : await db.query<ExportProjection>(
          `select id, batch_id, status, object_key, created_at, requested_by
             from exports
            order by created_at desc`
        );
    return res.rows.map(toExportRow);
  } finally {
    await db.close();
  }
}

/**
 * Retention purge PREVIEW (plan "Retention purge" phase one): purge-eligible
 * rows grouped by aggregate type, with the oldest eligible timestamp, as of
 * `asOf`. Reads only — phase two (the actual delete/redact) is a separate
 * service.
 */
export async function getRetentionPreview(
  principal: Principal,
  asOf: string | Date
): Promise<RetentionPreviewDTO> {
  requireAdmin(principal);
  const db = createPgPool();
  try {
    const at = asOf instanceof Date ? asOf.toISOString() : asOf;
    const res = await db.query<{
      aggregate_type: string;
      count: number;
      oldest: string | null;
    }>(
      `select
          aggregate_type,
          count(*)::int as count,
          min(purge_eligible_at) as oldest
         from retention_state
        where purge_eligible_at <= $1
          and purged_at is null
        group by aggregate_type
        order by aggregate_type asc`,
      [at]
    );

    const eligibleByAggregateType: Record<string, number> = {};
    let totalEligible = 0;
    let oldestEligibleAt: string | null = null;
    for (const row of res.rows) {
      eligibleByAggregateType[row.aggregate_type] = row.count;
      totalEligible += row.count;
      if (row.oldest && (oldestEligibleAt === null || row.oldest < oldestEligibleAt)) {
        oldestEligibleAt = row.oldest;
      }
    }
    return { eligibleByAggregateType, totalEligible, oldestEligibleAt };
  } finally {
    await db.close();
  }
}

/**
 * Storage reconciliation (plan "Storage consistency"): cross-check the DB's
 * stored object keys (from `case_files` and `exports`) against what actually
 * lives in the blob store via `storage.list(prefix)`.
 *
 *   - `missing_blob`: a DB manifest row points at an object key with NO blob in
 *     the store (the row promises an object that does not exist).
 *   - `orphaned_blob`: a blob exists in the store with NO DB row referencing it
 *     (a leaked / un-tracked object).
 *
 * The DB manifest — not the blob store — is the source of truth for what SHOULD
 * exist (plan "Storage consistency"), so missing_blob is the DB-driven set and
 * orphaned_blob is the store-driven set. `storage.list("")` lists the whole
 * store; pass a narrower prefix to scope a sweep.
 */
export async function getReconciliation(
  principal: Principal,
  storage: StorageAdapter,
  prefix = ""
): Promise<ReconciliationRowDTO[]> {
  requireAdmin(principal);
  const db = createPgPool();
  try {
    const [dbObjects, blobs] = await Promise.all([
      readStoredObjectKeys(db),
      storage.list(prefix),
    ]);

    const blobKeys = new Set(blobs.map((b) => b.key));
    const dbKeys = new Set(dbObjects.map((o) => o.objectKey));

    const findings: ReconciliationRowDTO[] = [];

    // missing_blob: DB row promises a key the store does not have.
    for (const obj of dbObjects) {
      if (!blobKeys.has(obj.objectKey)) {
        findings.push({
          objectKey: obj.objectKey,
          issue: "missing_blob",
          aggregateType: obj.aggregateType,
          aggregateId: obj.aggregateId,
        });
      }
    }

    // orphaned_blob: store has a key no DB row references.
    for (const blob of blobs) {
      if (!dbKeys.has(blob.key)) {
        findings.push({
          objectKey: blob.key,
          issue: "orphaned_blob",
          aggregateType: "unknown",
          aggregateId: null,
        });
      }
    }

    return findings;
  } finally {
    await db.close();
  }
}

// --- internals ---------------------------------------------------------------

interface DeadLetterJobRow {
  id: string;
  type: string;
  payload: unknown;
  attempts: number;
  dead_letter_reason: string | null;
  created_at: string;
}

interface AssignmentJoinRow {
  batch_id: string;
  batch_name: string | null;
  assigned_user_id: string | null;
  assignment_version: number;
  case_count: number;
}

interface ExportProjection {
  id: string;
  batch_id: string;
  status: ExportRowDTO["status"];
  object_key: string | null;
  created_at: string;
  requested_by: string;
}

/** A DB-side stored object key tagged with its owning aggregate. */
interface StoredObject {
  objectKey: string;
  aggregateType: string;
  aggregateId: string | null;
}

/** Inputs to {@link buildOpsHealth} — keeps the DTO assembly pure + testable. */
interface OpsHealthParts {
  stats: QueueStats;
  oldestJobAgeSeconds: number;
  caseCounts: { retryingCount: number; needsReviewCount: number; failedCount: number };
  exportFailureCount: number;
  retentionOverdueCount: number;
  workerLastHeartbeatAt: string | null;
  estimatedSpendUsd: number;
}

/** Assemble the OpsHealthDTO from its already-read parts. */
function buildOpsHealth(parts: OpsHealthParts): OpsHealthDTO {
  return {
    queueDepth: parts.stats.ready,
    oldestJobAgeSeconds: parts.oldestJobAgeSeconds,
    inflight: parts.stats.inflight,
    deadLetterCount: parts.stats.deadLetter,
    retryingCount: parts.caseCounts.retryingCount,
    needsReviewCount: parts.caseCounts.needsReviewCount,
    failedCount: parts.caseCounts.failedCount,
    exportFailureCount: parts.exportFailureCount,
    retentionOverdueCount: parts.retentionOverdueCount,
    workerLastHeartbeatAt: parts.workerLastHeartbeatAt,
    estimatedSpendUsd: parts.estimatedSpendUsd,
  };
}

/** Age (seconds) of the oldest claimable job, or 0 when the queue is empty. */
async function readOldestJobAgeSeconds(db: Queryable): Promise<number> {
  const res = await db.query<{ age_seconds: number | null }>(
    `select extract(epoch from (now() - min(created_at)))::int as age_seconds
       from queue_jobs
      where state in ('ready', 'inflight')`
  );
  const age = res.rows[0]?.age_seconds;
  return typeof age === "number" && age > 0 ? age : 0;
}

/** Case-level health counts: retrying / needs-review / failed families. */
async function readCaseHealthCounts(
  db: Queryable
): Promise<{ retryingCount: number; needsReviewCount: number; failedCount: number }> {
  const res = await db.query<{
    retrying: number;
    needs_review: number;
    failed: number;
  }>(
    `select
        count(*) filter (where status = any($1))::int as retrying,
        count(*) filter (where status = 'needs_review')::int as needs_review,
        count(*) filter (where status = any($2))::int as failed
       from cases`,
    [[...RETRYING_STATES], [...FAILED_STATES]]
  );
  const row = res.rows[0];
  return {
    retryingCount: row?.retrying ?? 0,
    needsReviewCount: row?.needs_review ?? 0,
    failedCount: row?.failed ?? 0,
  };
}

/** Count export bundles that finalized `failed`. */
async function readExportFailureCount(db: Queryable): Promise<number> {
  const res = await db.query<{ count: number }>(
    `select count(*)::int as count from exports where status = 'failed'`
  );
  return res.rows[0]?.count ?? 0;
}

/** Count retention rows whose purge window has opened but are not yet purged. */
async function readRetentionOverdueCount(db: Queryable): Promise<number> {
  const res = await db.query<{ count: number }>(
    `select count(*)::int as count
       from retention_state
      where purge_eligible_at <= now()
        and purged_at is null`
  );
  return res.rows[0]?.count ?? 0;
}

/**
 * Read every DB-side stored object key from the manifests (`case_files`) and
 * `exports`, tagged with its owning aggregate, for reconciliation. Null/empty
 * object keys are skipped — a row with no key promises no blob.
 */
async function readStoredObjectKeys(db: Queryable): Promise<StoredObject[]> {
  const res = await db.query<{
    object_key: string | null;
    aggregate_type: string;
    aggregate_id: string;
  }>(
    `select object_key, 'case_file' as aggregate_type, id as aggregate_id
       from case_files
      where object_key is not null
     union all
     select object_key, 'export' as aggregate_type, id as aggregate_id
       from exports
      where object_key is not null`
  );
  const out: StoredObject[] = [];
  for (const row of res.rows) {
    if (row.object_key && row.object_key.length > 0) {
      out.push({
        objectKey: row.object_key,
        aggregateType: row.aggregate_type,
        aggregateId: row.aggregate_id,
      });
    }
  }
  return out;
}

function toDeadLetterRow(row: DeadLetterJobRow): DeadLetterRowDTO {
  return {
    jobId: row.id,
    caseId: extractCaseId(row.payload),
    type: row.type,
    attempts: row.attempts,
    reason: row.dead_letter_reason,
    lastAt: row.created_at,
  };
}

function toAssignmentRow(row: AssignmentJoinRow): AssignmentRowDTO {
  return {
    batchId: row.batch_id,
    batchName: row.batch_name ?? row.batch_id,
    assignedUserId: row.assigned_user_id,
    assignmentVersion: row.assignment_version,
    caseCount: row.case_count,
  };
}

function toExportRow(row: ExportProjection): ExportRowDTO {
  return {
    id: row.id,
    batchId: row.batch_id,
    status: row.status,
    objectKey: row.object_key,
    createdAt: row.created_at,
    requestedBy: row.requested_by,
  };
}

/** Best-effort `payload.caseId` extraction — parse-or-null at the seam. */
function extractCaseId(payload: unknown): string | null {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "caseId" in payload &&
    typeof (payload as { caseId: unknown }).caseId === "string"
  ) {
    return (payload as { caseId: string }).caseId;
  }
  return null;
}
