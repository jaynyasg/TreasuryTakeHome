import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { getCase, insertCase, setCaseStatus } from "@/lib/db/repositories/cases";
import { listDispositions } from "@/lib/db/repositories/dispositions";
import { listAuditEvents } from "@/lib/db/repositories/auditEvents";
import {
  MissingReasonError,
  recordDisposition,
} from "@/lib/db/services/recordDisposition";
import { migratedClient, seedUser } from "./helpers";

describe("recordDisposition service-command", () => {
  let db: DbClient;
  let ownerId: string;
  let reviewerId: string;

  beforeEach(async () => {
    db = await migratedClient();
    ownerId = await seedUser(db, "admin");
    reviewerId = await seedUser(db, "reviewer");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
    await insertCase(db, { id: "case-1", batchId: "batch-1" });
    // Drive the case into a state from which disposition is legal.
    await setCaseStatus(db, "case-1", "queued");
    await setCaseStatus(db, "case-1", "extracting");
    await setCaseStatus(db, "case-1", "scoring");
    await setCaseStatus(db, "case-1", "needs_review");
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("commits the disposition, case transition, and audit event atomically", async () => {
    const result = await recordDisposition(db, {
      dispositionId: "disp-1",
      auditEventId: "audit-1",
      caseId: "case-1",
      actorUserId: reviewerId,
      action: "approve",
    });

    expect(result.disposition.id).toBe("disp-1");
    expect(result.case.status).toBe("disposition_recorded");
    expect(result.auditEvent.action).toBe("disposition.approve");

    // All three writes are visible.
    expect(await getCase(db, "case-1").then((c) => c?.status)).toBe(
      "disposition_recorded"
    );
    expect((await listDispositions(db, "case-1")).map((d) => d.id)).toEqual([
      "disp-1",
    ]);
    const events = await listAuditEvents(db, "case", "case-1");
    expect(events.map((e) => e.id)).toEqual(["audit-1"]);
    expect(events[0].action).toBe("disposition.approve");
  });

  it("records a reason for reject and stamps the audit reason", async () => {
    const result = await recordDisposition(db, {
      dispositionId: "disp-1",
      auditEventId: "audit-1",
      caseId: "case-1",
      actorUserId: reviewerId,
      action: "reject",
      reason: "Brand name mismatch",
    });
    expect(result.disposition.reason).toBe("Brand name mismatch");
    expect(result.auditEvent.reason).toBe("Brand name mismatch");
  });

  it("rejects a 'reject' with no reason and writes NOTHING", async () => {
    await expect(
      recordDisposition(db, {
        dispositionId: "disp-1",
        auditEventId: "audit-1",
        caseId: "case-1",
        actorUserId: reviewerId,
        action: "reject",
      })
    ).rejects.toBeInstanceOf(MissingReasonError);

    // Guard fires before the transaction opens: no rows, status unchanged.
    expect(await listDispositions(db, "case-1")).toEqual([]);
    expect(await listAuditEvents(db, "case", "case-1")).toEqual([]);
    expect(await getCase(db, "case-1").then((c) => c?.status)).toBe(
      "needs_review"
    );
  });

  it("treats a whitespace-only reason as missing for request_better_image", async () => {
    await expect(
      recordDisposition(db, {
        dispositionId: "disp-1",
        auditEventId: "audit-1",
        caseId: "case-1",
        actorUserId: reviewerId,
        action: "request_better_image",
        reason: "   ",
      })
    ).rejects.toBeInstanceOf(MissingReasonError);
  });

  it("rolls back ALL writes when the case is in an illegal state for disposition", async () => {
    // A fresh draft case cannot transition draft -> disposition_recorded.
    await insertCase(db, { id: "case-draft", batchId: "batch-1" });

    await expect(
      recordDisposition(db, {
        dispositionId: "disp-x",
        auditEventId: "audit-x",
        caseId: "case-draft",
        actorUserId: reviewerId,
        action: "approve",
      })
    ).rejects.toThrow(/Invalid case transition/);

    // The disposition insert inside the same tx must have rolled back.
    expect(await listDispositions(db, "case-draft")).toEqual([]);
    expect(await listAuditEvents(db, "case", "case-draft")).toEqual([]);
    expect(await getCase(db, "case-draft").then((c) => c?.status)).toBe("draft");
  });
});
