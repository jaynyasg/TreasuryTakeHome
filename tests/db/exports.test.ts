import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import {
  getExport,
  insertExport,
  listExportsByBatch,
  setExportStatus,
} from "@/lib/db/repositories/exports";
import { migratedClient, seedUser } from "./helpers";

describe("exports repository", () => {
  let db: DbClient;
  let ownerId: string;

  beforeEach(async () => {
    db = await migratedClient();
    ownerId = await seedUser(db, "admin");
    await insertBatch(db, { id: "batch-1", ownerUserId: ownerId });
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("inserts an export in 'generating' status with jsonb arrays round-tripped", async () => {
    const inserted = await insertExport(db, {
      id: "exp-1",
      batchId: "batch-1",
      requestedBy: ownerId,
      includedCaseIds: ["case-1", "case-2"],
      rulesetVersions: ["warning@2", "match@5"],
    });
    expect(inserted.status).toBe("generating");
    expect(inserted.object_key).toBeNull();
    expect(inserted.included_case_ids).toEqual(["case-1", "case-2"]);
    expect(inserted.ruleset_versions).toEqual(["warning@2", "match@5"]);
  });

  it("advances status to complete and stores the object key", async () => {
    await insertExport(db, {
      id: "exp-1",
      batchId: "batch-1",
      requestedBy: ownerId,
      includedCaseIds: ["case-1"],
    });

    const updated = await setExportStatus(db, "exp-1", "complete", {
      objectKey: "exports/batch-1/exp-1.zip",
    });
    expect(updated?.status).toBe("complete");
    expect(updated?.object_key).toBe("exports/batch-1/exp-1.zip");

    // jsonb survives the update untouched.
    const fetched = await getExport(db, "exp-1");
    expect(fetched?.included_case_ids).toEqual(["case-1"]);
  });

  it("status lifecycle: generating -> partial -> failed keeps prior object key", async () => {
    await insertExport(db, {
      id: "exp-1",
      batchId: "batch-1",
      requestedBy: ownerId,
    });

    await setExportStatus(db, "exp-1", "partial", {
      objectKey: "exports/partial.zip",
    });
    // Omitting objectKey leaves the stored key in place (coalesce).
    const failed = await setExportStatus(db, "exp-1", "failed");
    expect(failed?.status).toBe("failed");
    expect(failed?.object_key).toBe("exports/partial.zip");
  });

  it("lists a batch's exports most-recent first", async () => {
    await insertExport(db, {
      id: "exp-old",
      batchId: "batch-1",
      requestedBy: ownerId,
    });
    await db.query(
      "update exports set created_at = created_at - interval '1 second' where id = $1",
      ["exp-old"]
    );
    await insertExport(db, {
      id: "exp-new",
      batchId: "batch-1",
      requestedBy: ownerId,
    });

    const list = await listExportsByBatch(db, "batch-1");
    expect(list.map((e) => e.id)).toEqual(["exp-new", "exp-old"]);
  });

  it("setExportStatus on an unknown id returns null", async () => {
    expect(await setExportStatus(db, "nope", "complete")).toBeNull();
  });
});
