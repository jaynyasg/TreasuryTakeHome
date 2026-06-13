import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import {
  getBatch,
  insertBatch,
  listBatchesByOwner,
  setBatchStatus,
} from "@/lib/db/repositories/batches";
import { migratedClient, seedUser } from "./helpers";

describe("batches repository", () => {
  let db: DbClient;
  let ownerId: string;

  beforeEach(async () => {
    db = await migratedClient();
    ownerId = await seedUser(db, "reviewer");
  });

  afterEach(async () => {
    await db.close();
  });

  it("inserts and reads back a batch (defaulting to draft)", async () => {
    const inserted = await insertBatch(db, {
      id: "batch-1",
      name: "Spring COLA batch",
      ownerUserId: ownerId,
    });
    expect(inserted.status).toBe("draft");

    const fetched = await getBatch(db, "batch-1");
    expect(fetched?.name).toBe("Spring COLA batch");
    expect(fetched?.owner_user_id).toBe(ownerId);
  });

  it("allows a valid status transition (draft -> preflighting)", async () => {
    await insertBatch(db, { id: "batch-2", ownerUserId: ownerId });
    const updated = await setBatchStatus(db, "batch-2", "preflighting");
    expect(updated?.status).toBe("preflighting");
  });

  it("rejects an invalid status transition (draft -> purged)", async () => {
    await insertBatch(db, { id: "batch-3", ownerUserId: ownerId });
    await expect(setBatchStatus(db, "batch-3", "purged")).rejects.toThrow(
      /Invalid batch transition/
    );
  });

  it("lists batches by owner", async () => {
    await insertBatch(db, { id: "batch-4", ownerUserId: ownerId });
    await insertBatch(db, { id: "batch-5", ownerUserId: ownerId });
    const list = await listBatchesByOwner(db, ownerId);
    expect(list.map((b) => b.id).sort()).toEqual(["batch-4", "batch-5"]);
  });
});
