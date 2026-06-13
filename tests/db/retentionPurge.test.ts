import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";

import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import { insertCaseFile } from "@/lib/db/repositories/caseFiles";
import {
  listPurgeEligible,
  markPurgeEligible,
} from "@/lib/db/repositories/retention";
import { listAuditEvents } from "@/lib/db/repositories/auditEvents";
import {
  executePurge,
  previewPurge,
} from "@/lib/db/services/retentionPurge";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import { migratedClient, seedUser } from "./helpers";

describe("retentionPurge service (two-phase)", () => {
  let db: DbClient;
  let storage: StorageAdapter;
  let adminId: string;

  const asOf = new Date("2026-06-13T00:00:00.000Z");
  const eligibleAt = new Date("2026-01-01T00:00:00.000Z");

  beforeEach(async () => {
    db = await migratedClient();
    storage = createFakeStorage();
    adminId = await seedUser(db, "admin");

    await insertBatch(db, { id: "batch-1", ownerUserId: adminId });
    // A case with two stored blobs to delete on purge.
    await insertCase(db, { id: "case-1", batchId: "batch-1" });
    await storage.put("app/case-1", new Uint8Array([1, 2, 3]), {
      contentType: "application/pdf",
    });
    await storage.put("label/case-1", new Uint8Array([4, 5, 6]), {
      contentType: "image/png",
    });
    await insertCaseFile(db, {
      id: "cf-app",
      caseId: "case-1",
      kind: "application",
      objectKey: "app/case-1",
    });
    await insertCaseFile(db, {
      id: "cf-label",
      caseId: "case-1",
      kind: "label",
      objectKey: "label/case-1",
    });

    await markPurgeEligible(db, {
      id: "ret-case-1",
      aggregateType: "case",
      aggregateId: "case-1",
      purgeEligibleAt: eligibleAt,
    });
    await markPurgeEligible(db, {
      id: "ret-batch-1",
      aggregateType: "batch",
      aggregateId: "batch-1",
      purgeEligibleAt: eligibleAt,
    });
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("previewPurge lists eligible records with per-type counts and deletes nothing", async () => {
    const preview = await previewPurge(db, asOf);

    expect(preview.eligible.map((e) => e.retentionId).sort()).toEqual([
      "ret-batch-1",
      "ret-case-1",
    ]);
    expect(preview.counts).toEqual({ case: 1, batch: 1 });

    // Nothing deleted: blobs still present, records still eligible.
    expect(await storage.get("app/case-1")).not.toBeNull();
    expect((await listPurgeEligible(db, asOf)).length).toBe(2);
  });

  it("executePurge with killSwitchOn=true does NOTHING", async () => {
    const result = await executePurge(db, storage, {
      ids: ["ret-case-1", "ret-batch-1"],
      actorUserId: adminId,
      reason: "90-day retention",
      killSwitchOn: true,
    });

    expect(result).toEqual({ purged: 0, skipped: 2 });
    // Blobs intact, records still eligible, no audit events.
    expect(await storage.get("app/case-1")).not.toBeNull();
    expect(await storage.get("label/case-1")).not.toBeNull();
    expect((await listPurgeEligible(db, asOf)).length).toBe(2);
    expect(await listAuditEvents(db, "case", "case-1")).toEqual([]);
  });

  it("executePurge writes tombstones + audit + best-effort blob deletes", async () => {
    const result = await executePurge(db, storage, {
      ids: ["ret-case-1", "ret-batch-1"],
      actorUserId: adminId,
      reason: "90-day retention",
      killSwitchOn: false,
    });

    expect(result).toEqual({ purged: 2, skipped: 0 });

    // Blobs for the case aggregate are deleted (best-effort).
    expect(await storage.get("app/case-1")).toBeNull();
    expect(await storage.get("label/case-1")).toBeNull();

    // Both records are reflected as purged by the retention repo: no longer
    // eligible.
    expect(await listPurgeEligible(db, asOf)).toEqual([]);

    // Tombstone preserved on the case record with what/who/why + deleted keys.
    const { rows } = await db.query<{ tombstone: unknown; purged_at: string }>(
      "select tombstone, purged_at from retention_state where id = $1",
      ["ret-case-1"]
    );
    expect(rows[0].purged_at).not.toBeNull();
    const tombstone = rows[0].tombstone as {
      aggregateId: string;
      purgedBy: string;
      reason: string;
      deletedObjectKeys: string[];
    };
    expect(tombstone.aggregateId).toBe("case-1");
    expect(tombstone.purgedBy).toBe(adminId);
    expect(tombstone.reason).toBe("90-day retention");
    expect([...tombstone.deletedObjectKeys].sort()).toEqual([
      "app/case-1",
      "label/case-1",
    ]);

    // Audit event per purge.
    const caseEvents = await listAuditEvents(db, "case", "case-1");
    expect(caseEvents.some((e) => e.action === "retention.purge")).toBe(true);
    const batchEvents = await listAuditEvents(db, "batch", "batch-1");
    expect(batchEvents.some((e) => e.action === "retention.purge")).toBe(true);
  });

  it("skips an already-purged record on a re-run", async () => {
    await executePurge(db, storage, {
      ids: ["ret-case-1"],
      actorUserId: adminId,
      reason: "first pass",
      killSwitchOn: false,
    });
    const second = await executePurge(db, storage, {
      ids: ["ret-case-1"],
      actorUserId: adminId,
      reason: "second pass",
      killSwitchOn: false,
    });
    expect(second).toEqual({ purged: 0, skipped: 1 });
  });
});
