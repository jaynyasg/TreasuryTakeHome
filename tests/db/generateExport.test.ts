import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import type { MatchReport } from "@/lib/contract";

import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase, setCaseStatus } from "@/lib/db/repositories/cases";
import { insertVerdict } from "@/lib/db/repositories/verdicts";
import { listAuditEvents } from "@/lib/db/repositories/auditEvents";
import { getExport } from "@/lib/db/repositories/exports";
import { generateExport } from "@/lib/db/services/generateExport";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import { migratedClient, seedUser } from "./helpers";

/** A minimal contract-valid MatchReport payload for a verdict. */
function report(
  overall: MatchReport["overall"],
  matchPercentage: number
): MatchReport {
  return {
    matchPercentage,
    overall,
    summary: `${overall} (${matchPercentage}%)`,
    verdicts: [
      {
        field: "brandName",
        status: overall === "all_match" ? "match" : "mismatch",
        applicationValue: "Acme",
        labelValue: overall === "all_match" ? "Acme" : "Beta",
        reason: "Brand name comparison",
      },
    ],
  };
}

/** Drive a case through the lifecycle to a terminal scored/failed state. */
async function driveTo(
  db: DbClient,
  caseId: string,
  target: "clean_match" | "has_mismatches" | "failed"
): Promise<void> {
  await setCaseStatus(db, caseId, "queued");
  await setCaseStatus(db, caseId, "extracting");
  if (target === "failed") {
    await setCaseStatus(db, caseId, "failed");
    return;
  }
  await setCaseStatus(db, caseId, "scoring");
  await setCaseStatus(db, caseId, target);
}

describe("generateExport service-command", () => {
  let db: DbClient;
  let storage: StorageAdapter;
  let ownerId: string;

  beforeEach(async () => {
    db = await migratedClient();
    storage = createFakeStorage();
    ownerId = await seedUser(db, "admin");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("snapshots ALL cases, stores the CSV, marks complete, and audits", async () => {
    // Mixed terminal statuses: clean match, mismatch, failed.
    await insertCase(db, { id: "case-clean", batchId: "batch-1", brand: "Acme" });
    await insertCase(db, { id: "case-mismatch", batchId: "batch-1", brand: "Beta" });
    await insertCase(db, { id: "case-failed", batchId: "batch-1", brand: "Gamma" });

    await driveTo(db, "case-clean", "clean_match");
    await driveTo(db, "case-mismatch", "has_mismatches");
    await driveTo(db, "case-failed", "failed");

    await insertVerdict(db, {
      id: "v-clean",
      caseId: "case-clean",
      overall: "all_match",
      matchPercent: 100,
      payload: report("all_match", 100),
      rulesetVersion: "engine-1",
    });
    await insertVerdict(db, {
      id: "v-mismatch",
      caseId: "case-mismatch",
      overall: "has_mismatches",
      matchPercent: 50,
      payload: report("has_mismatches", 50),
      rulesetVersion: "engine-1",
    });

    const result = await generateExport(db, storage, {
      batchId: "batch-1",
      requestedBy: ownerId,
      rulesetVersions: ["engine-1"],
    });

    // Includes EVERY case (clean, mismatch, AND failed-with-no-verdict).
    expect([...result.includedCaseIds].sort()).toEqual(
      ["case-clean", "case-failed", "case-mismatch"].sort()
    );

    // All cases settled -> complete.
    expect(result.status).toBe("complete");

    // CSV artifact is in fake storage at the expected key.
    expect(result.objectKey).toBe(`exports/batch-1/${result.exportId}.csv`);
    const stored = await storage.get(result.objectKey);
    expect(stored).not.toBeNull();
    const csv = new TextDecoder().decode(stored!.data);
    expect(csv).toContain("case-clean");
    expect(csv).toContain("case-mismatch");
    expect(csv).toContain("case-failed"); // failed case still in the artifact
    expect(csv).toContain("100"); // clean match pct
    expect(csv).toContain("failed"); // failed case status in error column

    // Export row persisted complete with object key + included ids.
    const row = await getExport(db, result.exportId);
    expect(row?.status).toBe("complete");
    expect(row?.object_key).toBe(result.objectKey);
    expect([...(row?.included_case_ids ?? [])].sort()).toEqual(
      ["case-clean", "case-failed", "case-mismatch"].sort()
    );
    expect(row?.ruleset_versions).toEqual(["engine-1"]);

    // Audit event written against the batch.
    const events = await listAuditEvents(db, "batch", "batch-1");
    const exportEvent = events.find((e) => e.action === "export.generate");
    expect(exportEvent).toBeDefined();
  });

  it("marks the export partial when a case is still processing", async () => {
    await insertCase(db, { id: "case-done", batchId: "batch-1" });
    await insertCase(db, { id: "case-running", batchId: "batch-1" });

    await driveTo(db, "case-done", "clean_match");
    await insertVerdict(db, {
      id: "v-done",
      caseId: "case-done",
      overall: "all_match",
      matchPercent: 100,
      payload: report("all_match", 100),
    });

    // case-running is left mid-flight (queued -> extracting).
    await setCaseStatus(db, "case-running", "queued");
    await setCaseStatus(db, "case-running", "extracting");

    const result = await generateExport(db, storage, {
      batchId: "batch-1",
      requestedBy: ownerId,
    });

    expect(result.status).toBe("partial");
    // The in-progress case is STILL included in the snapshot.
    expect(result.includedCaseIds).toContain("case-running");
    const row = await getExport(db, result.exportId);
    expect(row?.status).toBe("partial");
  });
});
