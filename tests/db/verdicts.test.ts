import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import {
  getLatestVerdict,
  insertVerdict,
  listVerdicts,
} from "@/lib/db/repositories/verdicts";
import { migratedClient, seedUser } from "./helpers";

describe("verdicts repository", () => {
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

  it("inserts a verdict and round-trips the jsonb payload as a parsed object", async () => {
    const payload = {
      fields: [{ name: "brand", verdict: "match", score: 0.97 }],
      warnings: ["government_warning_ok"],
    };
    const inserted = await insertVerdict(db, {
      id: "verdict-1",
      caseId: "case-1",
      overall: "clean_match",
      matchPercent: 96.5,
      payload,
      rulesetVersion: "2026.06.01",
    });

    expect(inserted.overall).toBe("clean_match");
    expect(Number(inserted.match_percent)).toBeCloseTo(96.5);
    // jsonb comes back already parsed as an object, not a string.
    expect(typeof inserted.payload).toBe("object");
    expect(inserted.payload).toEqual(payload);

    const latest = await getLatestVerdict(db, "case-1");
    expect(latest?.payload).toEqual(payload);
    expect(typeof latest?.payload).toBe("object");
  });

  it("stores a null payload and null match_percent", async () => {
    const inserted = await insertVerdict(db, {
      id: "verdict-null",
      caseId: "case-1",
      overall: "needs_review",
    });
    expect(inserted.payload).toBeNull();
    expect(inserted.match_percent).toBeNull();
  });

  it("getLatestVerdict returns the most recent by created_at", async () => {
    await insertVerdict(db, {
      id: "v-old",
      caseId: "case-1",
      overall: "has_mismatches",
      payload: { round: 1 },
    });
    await insertVerdict(db, {
      id: "v-new",
      caseId: "case-1",
      overall: "clean_match",
      payload: { round: 2 },
    });
    // Nudge the newer verdict's created_at forward so ordering is deterministic
    // even when both inserts land within the same now() tick.
    await db.query(
      "update verdicts set created_at = now() + interval '1 second' where id = $1",
      ["v-new"]
    );

    const latest = await getLatestVerdict(db, "case-1");
    expect(latest?.id).toBe("v-new");
    expect(latest?.payload).toEqual({ round: 2 });
  });

  it("getLatestVerdict returns null when none recorded", async () => {
    const latest = await getLatestVerdict(db, "case-1");
    expect(latest).toBeNull();
  });

  it("lists verdicts oldest first", async () => {
    await insertVerdict(db, { id: "v-1", caseId: "case-1" });
    await insertVerdict(db, { id: "v-2", caseId: "case-1" });
    const list = await listVerdicts(db, "case-1");
    expect(list).toHaveLength(2);
  });
});
