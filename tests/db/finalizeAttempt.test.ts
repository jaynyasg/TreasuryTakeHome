import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { getCase, insertCase, setCaseStatus } from "@/lib/db/repositories/cases";
import { listAuditEvents } from "@/lib/db/repositories/auditEvents";
import {
  listAttempts,
  startAttempt,
} from "@/lib/db/repositories/processingAttempts";
import { finalizeAttempt } from "@/lib/db/services/finalizeAttempt";
import { migratedClient, seedUser } from "./helpers";

// Drive a fresh case through valid transitions to `scoring`, with a running
// scoring attempt, ready to be finalized.
async function seedScoringCase(db: DbClient, caseId: string): Promise<void> {
  await insertCase(db, { id: caseId, batchId: "batch-1" });
  await setCaseStatus(db, caseId, "queued");
  await setCaseStatus(db, caseId, "extracting");
  await setCaseStatus(db, caseId, "scoring");
}

describe("finalizeAttempt service-command", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await migratedClient();
    const ownerId = await seedUser(db, "reviewer");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
  });

  afterEach(async () => {
    await db.close();
  });

  it("commits attempt outcome + case status + audit atomically", async () => {
    await seedScoringCase(db, "case-ok");
    await startAttempt(db, { id: "att-ok", caseId: "case-ok", stage: "scoring" });

    const result = await finalizeAttempt(db, {
      attemptId: "att-ok",
      caseId: "case-ok",
      attemptState: "succeeded",
      targetCaseState: "clean_match",
      auditEventId: "audit-ok",
      actorUserId: null,
      traceId: "trace-ok",
    });

    expect(result.caseStatus).toBe("clean_match");
    expect(result.attempt.state).toBe("succeeded");

    // Case advanced.
    expect((await getCase(db, "case-ok"))?.status).toBe("clean_match");
    // Attempt recorded as succeeded.
    const attempts = await listAttempts(db, "case-ok");
    expect(attempts[0].state).toBe("succeeded");
    // Audit event committed in the same transaction.
    const audit = await listAuditEvents(db, "case", "case-ok");
    expect(audit.map((e) => e.id)).toEqual(["audit-ok"]);
  });

  it("rolls back ALL writes when the case transition is invalid", async () => {
    await seedScoringCase(db, "case-bad");
    await startAttempt(db, {
      id: "att-bad",
      caseId: "case-bad",
      stage: "scoring",
    });

    // scoring -> archived is not a legal case transition: setCaseStatus throws.
    await expect(
      finalizeAttempt(db, {
        attemptId: "att-bad",
        caseId: "case-bad",
        attemptState: "succeeded",
        targetCaseState: "archived",
        auditEventId: "audit-bad",
        traceId: "trace-bad",
      })
    ).rejects.toThrow(/Invalid case transition/);

    // No partial writes: case status unchanged...
    expect((await getCase(db, "case-bad"))?.status).toBe("scoring");
    // ...attempt outcome NOT persisted (still running)...
    const attempts = await listAttempts(db, "case-bad");
    expect(attempts.map((a) => a.state)).toEqual(["running"]);
    // ...and no audit row was inserted.
    const audit = await listAuditEvents(db, "case", "case-bad");
    expect(audit).toEqual([]);
  });
});
