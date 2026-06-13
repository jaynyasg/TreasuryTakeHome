import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import {
  completeAttempt,
  countAttempts,
  listAttempts,
  startAttempt,
} from "@/lib/db/repositories/processingAttempts";
import { migratedClient, seedUser } from "./helpers";

describe("processingAttempts repository", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await migratedClient();
    const ownerId = await seedUser(db, "reviewer");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
    await insertCase(db, { id: "case-1", batchId: "batch-1" });
  });

  afterEach(async () => {
    await db.close();
  });

  it("starts a running attempt at attempt_no 1", async () => {
    const a = await startAttempt(db, {
      id: "att-1",
      caseId: "case-1",
      stage: "extracting",
      traceId: "trace-1",
    });
    expect(a.state).toBe("running");
    expect(a.attempt_no).toBe(1);
    expect(a.trace_id).toBe("trace-1");
  });

  it("completes a running attempt (start -> complete)", async () => {
    await startAttempt(db, { id: "att-1", caseId: "case-1", stage: "scoring" });
    const done = await completeAttempt(db, "att-1", { state: "succeeded" });
    expect(done?.state).toBe("succeeded");
  });

  it("records error fields on a failed completion", async () => {
    await startAttempt(db, { id: "att-1", caseId: "case-1", stage: "scoring" });
    const done = await completeAttempt(db, "att-1", {
      state: "failed",
      errorClass: "TimeoutError",
      errorDetail: "llm timed out",
      nextAttemptAt: "2026-06-13T00:00:00.000Z",
    });
    expect(done?.error_class).toBe("TimeoutError");
    expect(done?.error_detail).toBe("llm timed out");
    expect(done?.next_attempt_at).not.toBeNull();
  });

  it("returns null when completing a missing attempt", async () => {
    expect(await completeAttempt(db, "nope", { state: "failed" })).toBeNull();
  });

  it("increments attempt_no per case+stage", async () => {
    await startAttempt(db, { id: "e1", caseId: "case-1", stage: "extracting" });
    await completeAttempt(db, "e1", { state: "failed" });
    const e2 = await startAttempt(db, {
      id: "e2",
      caseId: "case-1",
      stage: "extracting",
    });
    expect(e2.attempt_no).toBe(2);

    // A different stage numbers independently, starting at 1.
    const s1 = await startAttempt(db, {
      id: "s1",
      caseId: "case-1",
      stage: "scoring",
    });
    expect(s1.attempt_no).toBe(1);
  });

  it("preserves history: completing does not delete prior attempts", async () => {
    await startAttempt(db, { id: "e1", caseId: "case-1", stage: "extracting" });
    await completeAttempt(db, "e1", { state: "failed" });
    await startAttempt(db, { id: "e2", caseId: "case-1", stage: "extracting" });
    await completeAttempt(db, "e2", { state: "succeeded" });

    const history = await listAttempts(db, "case-1");
    expect(history.map((a) => a.id)).toEqual(["e1", "e2"]);
    expect(history.map((a) => a.state)).toEqual(["failed", "succeeded"]);
  });

  it("counts attempts per stage", async () => {
    await startAttempt(db, { id: "e1", caseId: "case-1", stage: "extracting" });
    await startAttempt(db, { id: "e2", caseId: "case-1", stage: "extracting" });
    await startAttempt(db, { id: "s1", caseId: "case-1", stage: "scoring" });

    expect(await countAttempts(db, "case-1", "extracting")).toBe(2);
    expect(await countAttempts(db, "case-1", "scoring")).toBe(1);
  });
});
