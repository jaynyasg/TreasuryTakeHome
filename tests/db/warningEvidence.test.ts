import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import {
  getWarningEvidence,
  insertWarningEvidence,
  listNeedsReviewWarnings,
} from "@/lib/db/repositories/warningEvidence";
import { migratedClient, seedUser } from "./helpers";

describe("warningEvidence repository", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await migratedClient();
    const ownerId = await seedUser(db, "reviewer");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
    await insertCase(db, { id: "case-1", batchId: "batch-1" });
    await insertCase(db, { id: "case-2", batchId: "batch-1" });
    await insertCase(db, { id: "case-3", batchId: "batch-1" });
  });

  afterEach(async () => {
    await db.close();
  });

  it("inserts and reads back evidence, round-tripping the boolean lead_in_detected", async () => {
    const inserted = await insertWarningEvidence(db, {
      id: "we-1",
      caseId: "case-1",
      cropObjectKey: "crops/case-1/warning.png",
      leadInDetected: true,
      boldnessConfidence: 0.81,
      verdict: "pass",
    });
    expect(inserted.lead_in_detected).toBe(true);
    expect(typeof inserted.lead_in_detected).toBe("boolean");
    expect(inserted.crop_object_key).toBe("crops/case-1/warning.png");
    expect(Number(inserted.boldness_confidence)).toBeCloseTo(0.81);

    const fetched = await getWarningEvidence(db, "case-1");
    expect(fetched?.lead_in_detected).toBe(true);
  });

  it("round-trips a false boolean and a null confidence", async () => {
    const inserted = await insertWarningEvidence(db, {
      id: "we-false",
      caseId: "case-2",
      leadInDetected: false,
      uncertaintyReason: "lead-in text not found",
      verdict: "fail",
    });
    expect(inserted.lead_in_detected).toBe(false);
    expect(typeof inserted.lead_in_detected).toBe("boolean");
    expect(inserted.boldness_confidence).toBeNull();
  });

  it("filters to needs_review warnings only", async () => {
    await insertWarningEvidence(db, {
      id: "we-pass",
      caseId: "case-1",
      leadInDetected: true,
      verdict: "pass",
    });
    await insertWarningEvidence(db, {
      id: "we-review-a",
      caseId: "case-2",
      leadInDetected: true,
      boldnessConfidence: 0.45,
      uncertaintyReason: "ambiguous boldness",
      verdict: "needs_review",
    });
    await insertWarningEvidence(db, {
      id: "we-review-b",
      caseId: "case-3",
      leadInDetected: false,
      verdict: "needs_review",
    });

    const needsReview = await listNeedsReviewWarnings(db);
    expect(needsReview).toHaveLength(2);
    expect(needsReview.every((w) => w.verdict === "needs_review")).toBe(true);
    expect(needsReview.map((w) => w.id).sort()).toEqual([
      "we-review-a",
      "we-review-b",
    ]);
  });

  it("getWarningEvidence returns null when none recorded", async () => {
    const fetched = await getWarningEvidence(db, "case-1");
    expect(fetched).toBeNull();
  });
});
