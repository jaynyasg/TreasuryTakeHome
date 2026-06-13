/**
 * Stage 9 / T10+T11 — DETERMINISTIC OFFLINE END-TO-END SMOKE for the durable
 * batch path (plan "Required E2E smoke set" + "Post-deploy smoke", minus the
 * live browser, which stays deferred to a separate Playwright script — see
 * `docs/designs/stage-1-preflight.md` §4).
 *
 * This is the "tiny durable batch through intake -> worker -> triage ->
 * disposition -> export + dead-letter replay" smoke. It wires the REAL services
 * (startBatch, the worker loop, recordDisposition, generateExport,
 * replayDeadLetter) over the offline harness (PGlite + createMemoryQueue +
 * createFakeStorage + createStubModel) and proves every seam connects:
 *
 *   web/intake  -> startBatch            (batch + cases + jobs)
 *   queue       -> runOnce/processCaseJob (claim -> extract -> score -> verdict)
 *   db          -> cases/verdicts/attempts/audit transitions
 *   triage      -> recordDisposition      (human disposition + audit)
 *   exports     -> generateExport         (CSV artifact in storage)
 *   replay      -> replayDeadLetter        (poison job re-armed, append-only)
 *
 * It doubles as living documentation of the pipeline wiring: read top-to-bottom
 * to see exactly how a case flows from upload to export and how a dead-lettered
 * case is recovered. Fully deterministic — injected clock, no network, no real
 * providers.
 */
import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/lib/db/client";
import type { ColaApplication } from "@/lib/contract";

import { createMemoryQueue } from "@/lib/adapters/queue/memory";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import { createStubModel } from "@/lib/adapters/model/stub";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import type { QueueAdapter } from "@/lib/adapters/queue/types";
import type { WorkerDeps } from "@/worker/deps";

import { migratedClient, seedUser } from "../db/helpers";
import { createTestClock, CLEAN_MATCH_APPLICATION } from "../worker/harness";

// --- the real services under smoke ----------------------------------------
import { startBatch } from "@/lib/db/services/startBatch";
import { runOnce } from "@/worker/loop";
import { recordDisposition } from "@/lib/db/services/recordDisposition";
import { generateExport } from "@/lib/db/services/generateExport";
import { replayDeadLetter } from "@/lib/db/services/replayJob";

// --- the real repositories the smoke asserts against ----------------------
import { getCase, listCasesByBatch } from "@/lib/db/repositories/cases";
import { listVerdicts, getLatestVerdict } from "@/lib/db/repositories/verdicts";
import { listAttempts } from "@/lib/db/repositories/processingAttempts";
import { listAuditEvents } from "@/lib/db/repositories/auditEvents";
import { getLatestDisposition } from "@/lib/db/repositories/dispositions";
import { getExport } from "@/lib/db/repositories/exports";
import {
  createIntakeSession,
  addManifestEntry,
} from "@/lib/db/repositories/intake";

/**
 * Build one complete application+label manifest pair under a fresh intake
 * session and return the ids `startBatch` needs. Uploading a paired
 * `<caseKey>_application.pdf` + `<caseKey>_label.png` (both `uploaded`) is the
 * minimum a reviewer must do before the batch is processable.
 */
async function buildIntakeWithPair(
  db: DbClient,
  storage: StorageAdapter,
  caseKey: string
): Promise<{ intakeSessionId: string }> {
  const sessionId = `intake-${caseKey}`;
  const session = await createIntakeSession(db, {
    id: sessionId,
    idempotencyKey: `idem-${caseKey}`,
    manifestHash: `hash-${caseKey}`,
  });

  // Store the two object bytes (intake's upload step) and record manifest rows.
  const appName = `${caseKey}_application.pdf`;
  const labelName = `${caseKey}_label.png`;

  const appObj = await storage.put(appName, new Uint8Array([0x25, 0x50, 0x44, 0x46]), {
    contentType: "application/pdf",
  });
  const labelObj = await storage.put(
    labelName,
    new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    { contentType: "image/png" }
  );

  await addManifestEntry(db, {
    id: `me-${caseKey}-app`,
    intakeSessionId: session.id,
    fileName: appName,
    kind: "application",
    caseKey,
    checksum: appObj.checksum,
    sizeBytes: appObj.size,
    contentType: appObj.contentType,
    status: "uploaded",
    objectKey: appObj.key,
  });
  await addManifestEntry(db, {
    id: `me-${caseKey}-label`,
    intakeSessionId: session.id,
    fileName: labelName,
    kind: "label",
    caseKey,
    checksum: labelObj.checksum,
    sizeBytes: labelObj.size,
    contentType: labelObj.contentType,
    status: "uploaded",
  });

  return { intakeSessionId: session.id };
}

/** Compose worker deps from shared harness parts + a chosen model. */
function workerDeps(
  db: DbClient,
  queue: QueueAdapter,
  storage: StorageAdapter,
  model: WorkerDeps["model"],
  now: () => number,
  maxAttempts?: number
): WorkerDeps {
  return { db, queue, storage, model, now, maxAttempts };
}

describe("durable path smoke (intake -> worker -> triage -> disposition -> export + replay)", () => {
  let db: DbClient | null = null;

  afterEach(async () => {
    if (db) await db.close();
    db = null;
  });

  it("processes a tiny durable batch end-to-end and exports it", async () => {
    db = await migratedClient();
    const clock = createTestClock();
    const queue = createMemoryQueue(clock.now);
    const storage = createFakeStorage();
    const deps = workerDeps(db, queue, storage, createStubModel(), clock.now);

    const ownerId = await seedUser(db, "reviewer");
    const application: ColaApplication = CLEAN_MATCH_APPLICATION;

    // (a) INTAKE -> startBatch: a complete pair becomes a durable batch + queued
    //     case + an enqueued job.
    const { intakeSessionId } = await buildIntakeWithPair(db, storage, "case001");
    const started = await startBatch(db, queue, {
      intakeSessionId,
      ownerUserId: ownerId,
      applications: { case001: application },
    });

    expect(started.caseCount).toBe(1);
    const batchCases = await listCasesByBatch(db, started.batchId);
    expect(batchCases).toHaveLength(1);
    const caseId = batchCases[0].id;
    expect((await getCase(db, caseId))?.status).toBe("queued");
    // Exactly one ready job was enqueued for the case.
    expect(await queue.stats()).toEqual({ ready: 1, inflight: 0, deadLetter: 0 });

    // (b) WORKER -> runOnce: claim the job, extract via the stub, deterministically
    //     score, persist the verdict, and transition the case to a scored state.
    const outcomes = await runOnce(deps, { max: 10 });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].kind).toBe("scored");

    const scored = await getCase(db, caseId);
    expect(scored?.status).toBe("clean_match");
    const verdicts = await listVerdicts(db, caseId);
    expect(verdicts).toHaveLength(1);
    expect(verdicts[0].overall).toBe("all_match");
    expect(Number(verdicts[0].match_percent)).toBe(100);
    // Attempt succeeded and the queue drained (job acked).
    expect((await listAttempts(db, caseId)).at(-1)?.state).toBe("succeeded");
    expect(await queue.stats()).toEqual({ ready: 0, inflight: 0, deadLetter: 0 });

    // (c) TRIAGE -> recordDisposition: a reviewer approves the case; the
    //     disposition row, the case transition, and an audit event commit atomically.
    const dispo = await recordDisposition(db, {
      dispositionId: randomUUID(),
      auditEventId: randomUUID(),
      caseId,
      actorUserId: ownerId,
      action: "approve",
      reason: "clean match, evidence reviewed",
    });
    expect(dispo.disposition.action).toBe("approve");
    expect(dispo.case.status).toBe("disposition_recorded");
    expect((await getCase(db, caseId))?.status).toBe("disposition_recorded");
    expect((await getLatestDisposition(db, caseId))?.action).toBe("approve");
    // The disposition audit event is present on the case's audit trail.
    const caseAudit = await listAuditEvents(db, "case", caseId);
    expect(caseAudit.some((e) => e.action === "disposition.approve")).toBe(true);

    // (d) EXPORT -> generateExport: a point-in-time CSV artifact covering the
    //     case is written to storage and recorded complete.
    const exp = await generateExport(db, storage, {
      batchId: started.batchId,
      requestedBy: ownerId,
      rulesetVersions: ["engine-1"],
    });
    expect(exp.includedCaseIds).toContain(caseId);
    expect(exp.status).toBe("complete");

    const exportRow = await getExport(db, exp.exportId);
    expect(exportRow?.status).toBe("complete");
    expect(exportRow?.object_key).toBe(exp.objectKey);

    const artifact = await storage.get(exp.objectKey);
    expect(artifact).not.toBeNull();
    const csv = new TextDecoder().decode(artifact!.data);
    expect(csv).toContain(caseId);
    expect(artifact!.contentType).toBe("text/csv");
  });

  it("dead-letters a poison case, then an admin replay makes it processable again (append-only)", async () => {
    db = await migratedClient();
    const maxAttempts = 3;
    const clock = createTestClock();
    const queue = createMemoryQueue(clock.now);
    const storage = createFakeStorage();

    // A 'timeout' stub model: retryable, so the case retries to its budget and
    // then dead-letters (the poison-job path).
    const timeoutDeps = workerDeps(
      db,
      queue,
      storage,
      createStubModel({ ok: false, error: "timeout" }),
      clock.now,
      maxAttempts
    );

    const ownerId = await seedUser(db, "reviewer");
    const adminId = await seedUser(db, "admin");

    // INTAKE -> startBatch for a complete pair.
    const { intakeSessionId } = await buildIntakeWithPair(db, storage, "poison001");
    const started = await startBatch(db, queue, {
      intakeSessionId,
      ownerUserId: ownerId,
      applications: { poison001: CLEAN_MATCH_APPLICATION },
    });
    const caseId = (await listCasesByBatch(db, started.batchId))[0].id;

    // WORKER: drain the retry budget. Each runOnce claims the (re-armed) job;
    // advance the clock past each backoff so the parked job becomes claimable.
    // Attempt 1 -> retry_wait (backoff 1s).
    expect((await runOnce(timeoutDeps, { max: 1 }))[0].kind).toBe("retried");
    expect((await getCase(db, caseId))?.status).toBe("retry_wait");
    clock.advance(1500);
    // Attempt 2 -> retry_wait (backoff 2s).
    expect((await runOnce(timeoutDeps, { max: 1 }))[0].kind).toBe("retried");
    clock.advance(2500);
    // Attempt 3 -> budget exhausted -> dead-letter + finalize failed.
    expect((await runOnce(timeoutDeps, { max: 1 }))[0].kind).toBe("dead_letter");

    expect((await getCase(db, caseId))?.status).toBe("failed");
    const dlStats = await queue.stats();
    expect(dlStats.deadLetter).toBe(1);
    expect(dlStats.ready + dlStats.inflight).toBe(0);
    // Append-only attempt history: three attempts, last is dead_letter.
    const before = await listAttempts(db, caseId);
    expect(before).toHaveLength(3);
    expect(before.at(-1)?.state).toBe("dead_letter");

    // ADMIN REPLAY -> replayDeadLetter: append a NEW attempt, move the case back
    // to queued, and re-enqueue a fresh job (new idempotency key). Prior
    // attempts/evidence are never overwritten.
    const replay = await replayDeadLetter(db, queue, {
      caseId,
      jobId: `job-${caseId}`,
      actorUserId: adminId,
      reason: "upstream timeout resolved; re-running",
    });
    expect(replay.replayed).toBe(true);

    // The case is processable again.
    expect((await getCase(db, caseId))?.status).toBe("queued");
    // Append-only: a 4th attempt now exists; the dead_letter row is still intact.
    const after = await listAttempts(db, caseId);
    expect(after).toHaveLength(4);
    expect(after[2].state).toBe("dead_letter"); // original terminal attempt preserved
    // A fresh job is claimable (the replay re-enqueue, not deduped).
    expect((await queue.stats()).ready).toBe(1);
    // The replay wrote a guarded audit event.
    const audit = await listAuditEvents(db, "case", caseId);
    expect(audit.some((e) => e.action === "replay.dead_letter")).toBe(true);

    // PROVE PROCESSABLE: with the upstream fixed (a clean model), the SAME db +
    // queue + storage now process the replayed case to a scored verdict.
    const fixedDeps = workerDeps(db, queue, storage, createStubModel(), clock.now, maxAttempts);
    const out = await runOnce(fixedDeps, { max: 1 });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("scored");
    expect((await getCase(db, caseId))?.status).toBe("clean_match");
    expect(await getLatestVerdict(db, caseId)).not.toBeNull();
    // The replay job acked; the ORIGINAL poison job stays parked in dead-letter
    // (append-only: replay never overwrites prior evidence in place).
    const finalStats = await queue.stats();
    expect(finalStats.ready).toBe(0);
    expect(finalStats.inflight).toBe(0);
    expect(finalStats.deadLetter).toBe(1);
  });
});
