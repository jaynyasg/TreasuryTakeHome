import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import {
  getLatestDisposition,
  insertDisposition,
  listDispositions,
} from "@/lib/db/repositories/dispositions";
import { migratedClient, seedUser } from "./helpers";

describe("dispositions repository", () => {
  let db: DbClient;
  let ownerId: string;

  beforeEach(async () => {
    db = await migratedClient();
    ownerId = await seedUser(db, "reviewer");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
    await insertCase(db, { id: "case-1", batchId: "batch-1" });
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("inserts and reads back a disposition", async () => {
    const inserted = await insertDisposition(db, {
      id: "disp-1",
      caseId: "case-1",
      actorUserId: ownerId,
      action: "approve",
    });
    expect(inserted.action).toBe("approve");
    expect(inserted.reason).toBeNull();

    const latest = await getLatestDisposition(db, "case-1");
    expect(latest?.id).toBe("disp-1");
  });

  it("getLatestDisposition returns null when none recorded", async () => {
    expect(await getLatestDisposition(db, "case-1")).toBeNull();
  });

  it("lists dispositions oldest-first and tracks the latest", async () => {
    await insertDisposition(db, {
      id: "disp-a",
      caseId: "case-1",
      actorUserId: ownerId,
      action: "request_better_image",
      reason: "blurry",
    });
    // Force a distinct created_at ordering.
    await db.query(
      "update dispositions set created_at = created_at - interval '1 second' where id = $1",
      ["disp-a"]
    );
    await insertDisposition(db, {
      id: "disp-b",
      caseId: "case-1",
      actorUserId: ownerId,
      action: "approve",
    });

    const list = await listDispositions(db, "case-1");
    expect(list.map((d) => d.id)).toEqual(["disp-a", "disp-b"]);

    const latest = await getLatestDisposition(db, "case-1");
    expect(latest?.id).toBe("disp-b");
  });
});
