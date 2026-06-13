import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import {
  getCaseFile,
  insertCaseFile,
  listCaseFiles,
  listFilesByRetentionState,
} from "@/lib/db/repositories/caseFiles";
import { migratedClient, seedUser } from "./helpers";

describe("caseFiles repository", () => {
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

  it("inserts and reads back a file", async () => {
    const inserted = await insertCaseFile(db, {
      id: "file-1",
      caseId: "case-1",
      kind: "application",
      objectProvider: "s3",
      objectKey: "k/app.pdf",
      checksum: "abc123",
      sizeBytes: 2048,
      contentType: "application/pdf",
      retentionState: "active",
    });
    expect(inserted.kind).toBe("application");
    expect(Number(inserted.size_bytes)).toBe(2048);

    const fetched = await getCaseFile(db, "file-1");
    expect(fetched?.object_key).toBe("k/app.pdf");
    expect(fetched?.retention_state).toBe("active");
  });

  it("returns null for a missing file", async () => {
    expect(await getCaseFile(db, "nope")).toBeNull();
  });

  it("lists a case's files oldest first", async () => {
    await insertCaseFile(db, { id: "f-app", caseId: "case-1", kind: "application" });
    await insertCaseFile(db, { id: "f-label", caseId: "case-1", kind: "label" });

    const list = await listCaseFiles(db, "case-1");
    expect(list.map((f) => f.id)).toEqual(["f-app", "f-label"]);
  });

  it("lists files filtered by retention state", async () => {
    await insertCaseFile(db, {
      id: "f-purge",
      caseId: "case-1",
      kind: "label",
      objectKey: "z",
      retentionState: "purge_eligible",
    });
    await insertCaseFile(db, {
      id: "f-active",
      caseId: "case-1",
      kind: "application",
      objectKey: "a",
      retentionState: "active",
    });

    const eligible = await listFilesByRetentionState(db, "purge_eligible");
    expect(eligible.map((f) => f.id)).toEqual(["f-purge"]);
  });
});
