import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import {
  assignCase,
  getCase,
  insertCase,
  listCasesByBatch,
  setCaseStatus,
} from "@/lib/db/repositories/cases";
import { migratedClient, seedUser } from "./helpers";

describe("cases repository", () => {
  let db: DbClient;
  let ownerId: string;

  beforeEach(async () => {
    db = await migratedClient();
    ownerId = await seedUser(db, "reviewer");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
  });

  afterEach(async () => {
    await db.close();
  });

  it("inserts and reads back a case (defaulting to draft)", async () => {
    const inserted = await insertCase(db, {
      id: "case-1",
      batchId: "batch-1",
      brand: "OLD TOM",
    });
    expect(inserted.status).toBe("draft");
    const fetched = await getCase(db, "case-1");
    expect(fetched?.brand).toBe("OLD TOM");
  });

  it("allows a valid status transition (draft -> queued)", async () => {
    await insertCase(db, { id: "case-2", batchId: "batch-1" });
    const updated = await setCaseStatus(db, "case-2", "queued");
    expect(updated?.status).toBe("queued");
  });

  it("rejects an invalid status transition (draft -> purged)", async () => {
    await insertCase(db, { id: "case-3", batchId: "batch-1" });
    await expect(setCaseStatus(db, "case-3", "purged")).rejects.toThrow(
      /Invalid case transition/
    );
  });

  it("assigns a case to a user", async () => {
    await insertCase(db, { id: "case-4", batchId: "batch-1" });
    const assignee = await seedUser(db, "reviewer");
    const updated = await assignCase(db, "case-4", assignee);
    expect(updated?.assigned_user_id).toBe(assignee);
  });

  it("lists cases severity-ordered (red, amber, green, then nulls)", async () => {
    await insertCase(db, { id: "c-green", batchId: "batch-1", severity: "green" });
    await insertCase(db, { id: "c-null", batchId: "batch-1" });
    await insertCase(db, { id: "c-red", batchId: "batch-1", severity: "red" });
    await insertCase(db, { id: "c-amber", batchId: "batch-1", severity: "amber" });

    const list = await listCasesByBatch(db, "batch-1");
    expect(list.map((c) => c.id)).toEqual([
      "c-red",
      "c-amber",
      "c-green",
      "c-null",
    ]);
  });
});
