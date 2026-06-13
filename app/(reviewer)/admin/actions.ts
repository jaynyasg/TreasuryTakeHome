"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/server/session";
import { requireAdmin } from "@/lib/server/admin";
import { NotAuthorizedError } from "@/lib/server/queries";
import { createPgPool } from "@/lib/db/pg";
import type { DbClient } from "@/lib/db/client";
import { createPostgresOutboxQueue } from "@/lib/adapters/queue/postgresOutbox";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import { createVercelBlobStorage } from "@/lib/adapters/storage/vercelBlob";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import {
  replayDeadLetter,
  MissingReasonError,
  CaseNotFoundError,
} from "@/lib/db/services/replayJob";
import { reassign, StaleAssignmentError } from "@/lib/db/repositories/assignments";
import { generateExport } from "@/lib/db/services/generateExport";
import {
  previewPurge,
  executePurge,
} from "@/lib/db/services/retentionPurge";
import { isPurgeKillSwitchOn } from "@/components/admin/killSwitches";
import { isReplayDisabled, areExportsDisabled } from "@/lib/flags";

/**
 * Admin Operations Console server actions (Stage 8 / T8+T9).
 *
 * Every action is the AUTHORITATIVE write path for a destructive / external
 * admin operation (replay, reassign, generate-export, purge). Each one:
 *   1. re-resolves the principal (`requirePrincipal` → redirects to /login when
 *      absent) and RE-checks `requireAdmin` at write time — the page render-time
 *      guard is never trusted as the only gate,
 *   2. builds its own pg pool (+ queue / storage adapters as needed) and CLOSES
 *      the pool in a `finally`,
 *   3. delegates to the matching service-command, which owns the transaction +
 *      append-only audit event + reason enforcement,
 *   4. `revalidatePath`s the affected admin tab so the table re-reads, and
 *   5. returns a typed `{ ok, error? }` — expected failures (forbidden, missing
 *      reason, stale assignment, not found) become friendly messages, never
 *      thrown to the client.
 *
 * The reason rule is enforced TWICE: the client dialog gates empty reasons for a
 * fast UX, and the service-command (`replayDeadLetter` / `executePurge`) is the
 * authoritative re-check here. The purge kill switch is read from env at action
 * time (`isPurgeKillSwitchOn`) and passed into `executePurge`, which deletes
 * NOTHING when engaged.
 */

/** Discriminated result returned by every admin action. */
export interface AdminActionResult {
  ok: boolean;
  /** Friendly message populated when `ok` is false. */
  error?: string;
}

/** Select the storage adapter for the active provider (mirrors the file route). */
function selectStorage(): StorageAdapter {
  return process.env.STORAGE_PROVIDER === "vercel-blob"
    ? createVercelBlobStorage()
    : createFakeStorage();
}

/**
 * Resolve + admin-gate the caller, returning the principal. Throws
 * {@link NotAuthorizedError} (caught by each action) for non-admins.
 */
async function resolveAdmin(): ReturnType<typeof requirePrincipal> {
  const principal = await requirePrincipal();
  requireAdmin(principal);
  return principal;
}

// --- Replay (dead-letter) ----------------------------------------------------

export interface ReplayActionInput {
  caseId: string;
  jobId: string;
  /** Required justification (re-enforced by `replayDeadLetter`). */
  reason: string;
}

/**
 * Guarded admin replay of a dead-lettered case (plan "Admin replay controls").
 * Reason is REQUIRED — an empty reason is rejected by `replayDeadLetter`
 * (`MissingReasonError`) before any write. Re-enqueues with a fresh idempotency
 * key so the queue does not dedupe the replay.
 */
export async function replayAction(
  input: ReplayActionInput
): Promise<AdminActionResult> {
  let db: DbClient | null = null;
  try {
    const principal = await resolveAdmin();
    if (isReplayDisabled()) {
      return {
        ok: false,
        error:
          "Replay is disabled by the runtime kill switch. Enable it via ops/env to proceed.",
      };
    }
    db = createPgPool();
    const queue = createPostgresOutboxQueue(db);
    const result = await replayDeadLetter(db, queue, {
      caseId: input.caseId,
      jobId: input.jobId,
      actorUserId: principal.userId,
      reason: input.reason,
    });
    if (!result.replayed) {
      return { ok: false, error: result.reason ?? "This case is not eligible for replay." };
    }
    revalidatePath("/admin/failed");
    revalidatePath("/admin");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: replayErrorMessage(err) };
  } finally {
    await db?.close();
  }
}

function replayErrorMessage(err: unknown): string {
  if (err instanceof NotAuthorizedError) return "Operations actions are admin-only.";
  if (err instanceof MissingReasonError) return "A reason note is required to replay a job.";
  if (err instanceof CaseNotFoundError) return "That case no longer exists.";
  return "The job could not be replayed. Please try again.";
}

// --- Reassign ----------------------------------------------------------------

export interface ReassignActionInput {
  batchId: string;
  /** New owner. */
  userId: string;
  /** Optimistic-concurrency version the admin saw (plan "Assignment concurrency"). */
  expectedVersion: number;
}

/**
 * Reassign a batch under optimistic concurrency. When the stored
 * `assignment_version` has moved on (someone reassigned first),
 * {@link StaleAssignmentError} is mapped to a friendly stale-view message so the
 * admin re-reads and retries.
 */
export async function reassignAction(
  input: ReassignActionInput
): Promise<AdminActionResult> {
  let db: DbClient | null = null;
  try {
    await resolveAdmin();
    db = createPgPool();
    await reassign(db, input.batchId, input.userId, input.expectedVersion);
    revalidatePath("/admin/assignments");
    return { ok: true };
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      return { ok: false, error: "Operations actions are admin-only." };
    }
    if (err instanceof StaleAssignmentError) {
      return {
        ok: false,
        error:
          "This assignment changed since you loaded the page. Refresh to see the current owner and try again.",
      };
    }
    return { ok: false, error: "The batch could not be reassigned. Please try again." };
  } finally {
    await db?.close();
  }
}

// --- Generate export ---------------------------------------------------------

export interface GenerateExportActionInput {
  batchId: string;
}

/**
 * Generate a point-in-time export of a batch (plan "Export semantics"). Builds
 * the storage adapter for the active provider; the service writes the CSV blob
 * before marking the export terminal so a complete export always has a
 * retrievable artifact.
 */
export async function generateExportAction(
  input: GenerateExportActionInput
): Promise<AdminActionResult> {
  let db: DbClient | null = null;
  try {
    const principal = await resolveAdmin();
    if (areExportsDisabled()) {
      return {
        ok: false,
        error:
          "Exports are disabled by the runtime kill switch. Enable it via ops/env to proceed.",
      };
    }
    db = createPgPool();
    const storage = selectStorage();
    await generateExport(db, storage, {
      batchId: input.batchId,
      requestedBy: principal.userId,
    });
    revalidatePath("/admin/exports");
    return { ok: true };
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      return { ok: false, error: "Operations actions are admin-only." };
    }
    return { ok: false, error: "The export could not be generated. Please try again." };
  } finally {
    await db?.close();
  }
}

// --- Retention purge ---------------------------------------------------------

export interface PurgeActionInput {
  /** Retention row ids (from the preview) to purge. */
  ids: string[];
  /** Required justification (preserved in each tombstone + audit event). */
  reason: string;
}

/** Result of {@link purgeAction}: counts plus the kill-switch posture. */
export interface PurgeActionResult extends AdminActionResult {
  purged?: number;
  skipped?: number;
  /** True when the purge kill switch was engaged (nothing was deleted). */
  killSwitchOn?: boolean;
}

/**
 * Phase-two retention purge (plan "Retention purge"). Reads the purge kill
 * switch from env at action time and passes it into `executePurge`, which
 * deletes NOTHING when engaged (returns everything skipped). Reason is REQUIRED;
 * an empty reason is rejected before the action runs. Returns the tombstone /
 * result summary the Retention tab renders.
 */
export async function purgeAction(
  input: PurgeActionInput
): Promise<PurgeActionResult> {
  const reason = input.reason?.trim();
  if (!reason) {
    return { ok: false, error: "A reason note is required to approve a purge." };
  }
  if (!Array.isArray(input.ids) || input.ids.length === 0) {
    return { ok: false, error: "There are no purge-eligible records to purge." };
  }

  let db: DbClient | null = null;
  try {
    const principal = await resolveAdmin();
    const killSwitchOn = isPurgeKillSwitchOn();
    db = createPgPool();
    const storage = selectStorage();
    const result = await executePurge(db, storage, {
      ids: input.ids,
      actorUserId: principal.userId,
      reason,
      killSwitchOn,
    });
    revalidatePath("/admin/retention");
    revalidatePath("/admin");
    if (killSwitchOn) {
      return {
        ok: false,
        killSwitchOn: true,
        purged: result.purged,
        skipped: result.skipped,
        error:
          "Purge is disabled by the runtime kill switch. Nothing was deleted. Enable it via ops/env to proceed.",
      };
    }
    return { ok: true, killSwitchOn: false, purged: result.purged, skipped: result.skipped };
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      return { ok: false, error: "Operations actions are admin-only." };
    }
    return { ok: false, error: "The purge could not be completed. Please try again." };
  } finally {
    await db?.close();
  }
}

// --- Retention preview (re-read for the two-step flow) -----------------------

/** A purge-eligible record surfaced to the Retention tab's approve step. */
export interface PurgeEligibleRow {
  retentionId: string;
  aggregateType: string;
  aggregateId: string;
}

/** Result of {@link previewPurgeAction}. */
export interface PreviewPurgeActionResult extends AdminActionResult {
  eligible?: PurgeEligibleRow[];
  counts?: Record<string, number>;
}

/**
 * Re-read the purge-eligible set as of now, returning the concrete retention row
 * ids the Approve step purges (the health-tab preview is grouped counts only;
 * the two-step flow needs the actual ids). Read-only; deletes nothing.
 */
export async function previewPurgeAction(): Promise<PreviewPurgeActionResult> {
  let db: DbClient | null = null;
  try {
    await resolveAdmin();
    db = createPgPool();
    const preview = await previewPurge(db, new Date());
    return {
      ok: true,
      eligible: preview.eligible.map((e) => ({
        retentionId: e.retentionId,
        aggregateType: e.aggregateType,
        aggregateId: e.aggregateId,
      })),
      counts: preview.counts,
    };
  } catch (err) {
    if (err instanceof NotAuthorizedError) {
      return { ok: false, error: "Operations actions are admin-only." };
    }
    return { ok: false, error: "The purge preview could not be loaded. Please try again." };
  } finally {
    await db?.close();
  }
}
