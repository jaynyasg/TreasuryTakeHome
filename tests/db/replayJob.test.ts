import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import type { QueueAdapter } from "@/lib/adapters/queue/types";

import { insertBatch } from "@/lib/db/repositories/batches";
import { getCase, insertCase, setCaseStatus } from "@/lib/db/repositories/cases";
import {
  completeAttempt,
  listAttempts,
  startAttempt,
} from "@/lib/db/repositories/processingAttempts";
import { listAuditEvents } from "@/lib/db/repositories/auditEvents";
import {
  CaseNotFoundError,
  MissingReasonError,
  replayDeadLetter,
} from "@/lib/db/services/replayJob";
import { createMemoryQueue } from "@/lib/adapters/queue/memory";
import { migratedClient, seedUser } from "./helpers";

/** Drive a fresh case to dead_letter with one settled prior attempt on record. */
async function seedDeadLetterCase(db: DbClient, caseId: string): Promise<void> {
  await insertCase(db, { id: caseId, batchId: "batch-1" });
  await setCaseStatus(db, caseId, "queued");
  await setCaseStatus(db, caseId, "extracting");
  // A prior attempt exists and is settled (this is the evidence replay must
  // preserve, never overwrite).
  await startAttempt(db, { id: `${caseId}-att-1`, caseId, stage: "extracting" });
  await completeAttempt(db, `${caseId}-att-1`, {
    state: "dead_letter",
    errorClass: "timeout",
    errorDetail: "exhausted",
  });
  await setCaseStatus(db, caseId, "dead_letter");
}

describe("replayDeadLetter service-command (guarded admin replay)", () => {
  let db: DbClient;
  let queue: QueueAdapter;
  let adminId: string;

  beforeEach(async () => {
    db = await migratedClient();
    queue = createMemoryQueue();
    adminId = await seedUser(db, "admin");
    await insertBatch(db, { id: "batch-1", ownerUserId: adminId });
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("rejects an empty reason and writes NOTHING", async () => {
    await seedDeadLetterCase(db, "case-1");
    const before = await listAttempts(db, "case-1");

    await expect(
      replayDeadLetter(db, queue, {
        caseId: "case-1",
        jobId: "job-1",
        actorUserId: adminId,
        reason: "   ",
      })
    ).rejects.toBeInstanceOf(MissingReasonError);

    // No new attempt, case unchanged, no replay audit, queue empty.
    expect(await listAttempts(db, "case-1")).toHaveLength(before.length);
    expect(await getCase(db, "case-1").then((c) => c?.status)).toBe("dead_letter");
    const events = await listAuditEvents(db, "case", "case-1");
    expect(events.some((e) => e.action === "replay.dead_letter")).toBe(false);
    expect((await queue.stats()).ready).toBe(0);
  });

  it("appends a NEW attempt (prior preserved), re-enqueues, transitions, and audits", async () => {
    await seedDeadLetterCase(db, "case-1");

    const priorAttempts = await listAttempts(db, "case-1");
    expect(priorAttempts).toHaveLength(1);
    const priorIds = priorAttempts.map((a) => a.id);
    const priorSnapshot = JSON.stringify(priorAttempts);

    const result = await replayDeadLetter(db, queue, {
      caseId: "case-1",
      jobId: "job-1",
      actorUserId: adminId,
      reason: "image re-uploaded after repair",
    });

    expect(result.replayed).toBe(true);

    // APPEND-ONLY: attempt count increased, every prior attempt unchanged.
    const after = await listAttempts(db, "case-1");
    expect(after.length).toBe(priorAttempts.length + 1);
    const preserved = after.filter((a) => priorIds.includes(a.id));
    expect(JSON.stringify(preserved)).toBe(priorSnapshot);
    // The new attempt is a fresh `running` row.
    const fresh = after.find((a) => !priorIds.includes(a.id));
    expect(fresh?.state).toBe("running");

    // Case transitioned back to queued for re-claim.
    expect(await getCase(db, "case-1").then((c) => c?.status)).toBe("queued");

    // A ready job is enqueued (new idempotency key -> not deduped).
    expect((await queue.stats()).ready).toBe(1);
    const claimed = await queue.claim({ max: 5, visibilityTimeoutMs: 1000 });
    expect(claimed).toHaveLength(1);
    expect(claimed[0].payload).toMatchObject({ caseId: "case-1" });

    // Audit event with actor + reason + before/after.
    const events = await listAuditEvents(db, "case", "case-1");
    const replayEvent = events.find((e) => e.action === "replay.dead_letter");
    expect(replayEvent).toBeDefined();
    expect(replayEvent?.actor_user_id).toBe(adminId);
    expect(replayEvent?.reason).toBe("image re-uploaded after repair");
    expect(replayEvent?.before_summary).toMatchObject({ status: "dead_letter" });
    expect(replayEvent?.after_summary).toMatchObject({ status: "queued" });
  });

  it("rejects a non-eligible (clean_match) case without writing", async () => {
    await insertCase(db, { id: "case-clean", batchId: "batch-1" });
    await setCaseStatus(db, "case-clean", "queued");
    await setCaseStatus(db, "case-clean", "extracting");
    await setCaseStatus(db, "case-clean", "scoring");
    await setCaseStatus(db, "case-clean", "clean_match");

    const result = await replayDeadLetter(db, queue, {
      caseId: "case-clean",
      jobId: "job-x",
      actorUserId: adminId,
      reason: "should be rejected",
    });

    expect(result.replayed).toBe(false);
    expect(result.reason).toContain("not replay-eligible");
    // Unchanged: no new attempt, no replay audit, no enqueue.
    expect(await listAttempts(db, "case-clean")).toEqual([]);
    expect(await getCase(db, "case-clean").then((c) => c?.status)).toBe(
      "clean_match"
    );
    expect((await queue.stats()).ready).toBe(0);
  });

  it("throws CaseNotFoundError for an unknown case", async () => {
    await expect(
      replayDeadLetter(db, queue, {
        caseId: "missing",
        jobId: "job-z",
        actorUserId: adminId,
        reason: "valid reason",
      })
    ).rejects.toBeInstanceOf(CaseNotFoundError);
  });
});
