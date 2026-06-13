/**
 * View-safe DTOs for the admin Operations Console (Stage 8 / T8).
 *
 * These are the ONLY shapes that cross from the admin server data layer
 * (`lib/server/admin.ts`) into the admin pages / pure view helpers
 * (`lib/view/admin.ts`). Raw Postgres rows, queue adapter internals, and storage
 * listings never leak past `lib/server/admin.ts` — every admin read maps to one
 * of these DTOs so the UI cannot depend on column names or provider details.
 *
 * Mirrors the plan's "Operations Console", "Admin IA", "Product health metrics",
 * the "Storage consistency"/reconciliation decision, and the Ops Console row of
 * the Core UI State Table in `docs/designs/production-gap-closure.md`.
 *
 * Pure types only — no I/O, no React, no Next imports — so both the pure view
 * helpers and the server reads can depend on this file.
 */

/**
 * Product health metrics for the Operations Health tab (plan: "Product health
 * metrics" — queue depth, oldest job age, failure/retry/dead-letter rates,
 * needs-review count, export failures, retention overdue, worker heartbeat,
 * estimated model spend).
 *
 * Every count is a non-negative integer; ages/spend are non-negative numbers.
 * `workerLastHeartbeatAt` is null when the worker has never reported in.
 */
export interface OpsHealthDTO {
  /** Jobs claimable right now (queue ready depth). */
  queueDepth: number;
  /** Age in seconds of the oldest still-unprocessed job (0 when the queue is empty). */
  oldestJobAgeSeconds: number;
  /** Jobs currently claimed and inside their visibility window. */
  inflight: number;
  /** Poison jobs parked in dead-letter for admin replay. */
  deadLetterCount: number;
  /** Cases currently in the retry-wait family (awaiting a backed-off retry). */
  retryingCount: number;
  /** Cases awaiting a human review decision (needs_review). */
  needsReviewCount: number;
  /** Cases finalized failed/dead-letter (unrecoverable without replay). */
  failedCount: number;
  /** Export bundles that finalized in a `failed` status. */
  exportFailureCount: number;
  /** Retention rows whose purge window has opened but are not yet purged. */
  retentionOverdueCount: number;
  /** Epoch-ms ISO-8601 of the worker's last heartbeat, or null if never seen. */
  workerLastHeartbeatAt: string | null;
  /** Estimated model spend (USD) for the surfaced window. */
  estimatedSpendUsd: number;
}

/**
 * One dead-letter / failed job row for the "Failed / Dead-letter Jobs" tab
 * (plan Admin IA). Carries the failure reason + attempt count so an admin can
 * decide whether to replay.
 */
export interface DeadLetterRowDTO {
  jobId: string;
  /** Owning case id when the job is a case job; null for non-case jobs. */
  caseId: string | null;
  /** Job kind (queue job type). */
  type: string;
  /** Delivery/attempt count accrued before parking. */
  attempts: number;
  /** Preserved poison-job failure reason. */
  reason: string | null;
  /** ISO-8601 timestamp of the last activity on the job. */
  lastAt: string;
}

/** One row for the Assignments tab (plan Admin IA: "Reassign Batch / Case Ownership"). */
export interface AssignmentRowDTO {
  batchId: string;
  batchName: string;
  /** Currently-assigned reviewer, or null when unassigned. */
  assignedUserId: string | null;
  /** Optimistic-concurrency version (plan: "Assignment concurrency"). */
  assignmentVersion: number;
  /** Number of cases under the batch (workload cue). */
  caseCount: number;
}

/** One row for the Exports tab (plan Admin IA). */
export interface ExportRowDTO {
  id: string;
  batchId: string;
  status: "generating" | "complete" | "partial" | "failed";
  /** Object key of the generated artifact; null while generating / on failure. */
  objectKey: string | null;
  createdAt: string;
  requestedBy: string;
}

/**
 * Retention purge preview (plan: "Retention purge" — phase one: "mark records
 * purge-eligible and show preview/counts"). Counts purge-eligible rows grouped
 * by aggregate type so the admin can review scope before approving a purge.
 */
export interface RetentionPreviewDTO {
  /** Purge-eligible row counts keyed by aggregate type (e.g. case, batch, file). */
  eligibleByAggregateType: Record<string, number>;
  /** Total purge-eligible rows across all aggregate types. */
  totalEligible: number;
  /** ISO-8601 of the oldest eligible row, or null when nothing is eligible. */
  oldestEligibleAt: string | null;
}

/**
 * One storage-reconciliation finding (plan: "Storage consistency" —
 * "Reconciliation detects missing/orphaned blobs and surfaces repair/delete
 * actions in the operations console").
 *
 *   - `missing_blob`: a DB manifest row points at an object key with no blob.
 *   - `orphaned_blob`: a blob exists with no DB manifest row referencing it.
 */
export interface ReconciliationRowDTO {
  objectKey: string;
  issue: "missing_blob" | "orphaned_blob";
  /** Aggregate the key belongs to (e.g. "case_file", "export"). */
  aggregateType: string;
  /** Owning aggregate id when known (DB side); null for orphaned blobs. */
  aggregateId: string | null;
}
