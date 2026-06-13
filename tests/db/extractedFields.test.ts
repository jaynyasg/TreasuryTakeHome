import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import {
  insertExtractedField,
  insertExtractedFields,
  listExtractedFields,
} from "@/lib/db/repositories/extractedFields";
import { migratedClient, seedUser } from "./helpers";

describe("extractedFields repository", () => {
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

  it("inserts and reads back a single field", async () => {
    const inserted = await insertExtractedField(db, {
      id: "field-1",
      caseId: "case-1",
      fieldName: "brand",
      fieldValue: "OLD TOM",
      confidence: 0.92,
    });
    expect(inserted.field_name).toBe("brand");
    expect(inserted.field_value).toBe("OLD TOM");
    expect(Number(inserted.confidence)).toBeCloseTo(0.92);

    const list = await listExtractedFields(db, "case-1");
    expect(list).toHaveLength(1);
    expect(list[0].field_value).toBe("OLD TOM");
  });

  it("stores a null confidence (nullable numeric)", async () => {
    const inserted = await insertExtractedField(db, {
      id: "field-null",
      caseId: "case-1",
      fieldName: "class_type",
      fieldValue: "GIN",
    });
    expect(inserted.confidence).toBeNull();

    const list = await listExtractedFields(db, "case-1");
    expect(list[0].confidence).toBeNull();
  });

  it("bulk-inserts multiple fields for a case", async () => {
    const rows = await insertExtractedFields(db, "case-1", [
      { id: "f-a", fieldName: "brand", fieldValue: "OLD TOM", confidence: 0.9 },
      { id: "f-b", fieldName: "class_type", fieldValue: "GIN" },
      { id: "f-c", fieldName: "applicant", fieldValue: "ACME", confidence: 0.5 },
    ]);
    expect(rows).toHaveLength(3);

    const list = await listExtractedFields(db, "case-1");
    expect(list.map((f) => f.field_name).sort()).toEqual([
      "applicant",
      "brand",
      "class_type",
    ]);
    const classRow = list.find((f) => f.field_name === "class_type");
    expect(classRow?.confidence).toBeNull();
  });

  it("treats an empty bulk insert as a no-op", async () => {
    const rows = await insertExtractedFields(db, "case-1", []);
    expect(rows).toEqual([]);
    const list = await listExtractedFields(db, "case-1");
    expect(list).toHaveLength(0);
  });

  it("scopes listing to the requested case", async () => {
    await insertCase(db, { id: "case-2", batchId: "batch-1" });
    await insertExtractedField(db, {
      id: "field-2",
      caseId: "case-2",
      fieldName: "brand",
      fieldValue: "OTHER",
    });
    const list = await listExtractedFields(db, "case-1");
    expect(list).toHaveLength(0);
  });
});
