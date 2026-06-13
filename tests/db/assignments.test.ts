import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import {
  getAssignment,
  insertAssignment,
  reassign,
  StaleAssignmentError,
} from "@/lib/db/repositories/assignments";
import { migratedClient, seedUser } from "./helpers";

describe("assignments repository", () => {
  let db: DbClient;
  let ownerId: string;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    db = await migratedClient();
    ownerId = await seedUser(db, "admin");
    userA = await seedUser(db, "reviewer");
    userB = await seedUser(db, "reviewer");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("inserts an assignment defaulting to version 1", async () => {
    const inserted = await insertAssignment(db, {
      id: "assign-1",
      batchId: "batch-1",
      userId: userA,
    });
    expect(inserted.assignment_version).toBe(1);
    expect(inserted.user_id).toBe(userA);

    const fetched = await getAssignment(db, "batch-1");
    expect(fetched?.id).toBe("assign-1");
  });

  it("reassign with the matching version increments the version", async () => {
    await insertAssignment(db, {
      id: "assign-1",
      batchId: "batch-1",
      userId: userA,
    });

    const updated = await reassign(db, "batch-1", userB, 1);
    expect(updated.user_id).toBe(userB);
    expect(updated.assignment_version).toBe(2);

    const fetched = await getAssignment(db, "batch-1");
    expect(fetched?.assignment_version).toBe(2);
    expect(fetched?.user_id).toBe(userB);
  });

  it("reassign with a stale version throws and writes nothing", async () => {
    await insertAssignment(db, {
      id: "assign-1",
      batchId: "batch-1",
      userId: userA,
    });
    // First reassign succeeds, bumping to version 2.
    await reassign(db, "batch-1", userB, 1);

    // A second caller still holding expectedVersion 1 is now stale.
    await expect(reassign(db, "batch-1", userA, 1)).rejects.toBeInstanceOf(
      StaleAssignmentError
    );

    // No write happened: still userB at version 2.
    const fetched = await getAssignment(db, "batch-1");
    expect(fetched?.user_id).toBe(userB);
    expect(fetched?.assignment_version).toBe(2);
  });
});
