import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import {
  listPurgeEligible,
  markPurgeEligible,
  recordPurge,
} from "@/lib/db/repositories/retention";
import { migratedClient } from "./helpers";

describe("retention_state repository", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await migratedClient();
  }, 30000); // PGlite WASM cold-start can exceed the 10s default on first run.

  afterEach(async () => {
    await db.close();
  });

  it("marks an aggregate purge-eligible with nulls for purge fields", async () => {
    const row = await markPurgeEligible(db, {
      id: "ret-1",
      aggregateType: "batch",
      aggregateId: "batch-1",
      purgeEligibleAt: "2026-01-01T00:00:00.000Z",
    });
    expect(row.aggregate_type).toBe("batch");
    expect(row.purged_at).toBeNull();
    expect(row.tombstone).toBeNull();
  });

  it("lists only rows whose window has opened and that are not yet purged", async () => {
    await markPurgeEligible(db, {
      id: "ret-past",
      aggregateType: "batch",
      aggregateId: "b-past",
      purgeEligibleAt: "2026-01-01T00:00:00.000Z",
    });
    await markPurgeEligible(db, {
      id: "ret-future",
      aggregateType: "batch",
      aggregateId: "b-future",
      purgeEligibleAt: "2099-01-01T00:00:00.000Z",
    });

    const asOf = "2026-06-13T00:00:00.000Z";
    const eligible = await listPurgeEligible(db, asOf);
    expect(eligible.map((r) => r.id)).toEqual(["ret-past"]);
  });

  it("mark -> list -> recordPurge round-trips the tombstone and drops the row from the eligible list", async () => {
    await markPurgeEligible(db, {
      id: "ret-1",
      aggregateType: "case",
      aggregateId: "case-1",
      purgeEligibleAt: new Date("2026-01-01T00:00:00.000Z"),
    });

    const asOf = new Date("2026-06-13T00:00:00.000Z");
    expect((await listPurgeEligible(db, asOf)).map((r) => r.id)).toEqual([
      "ret-1",
    ]);

    const tombstone = {
      purgedObjects: ["o1", "o2"],
      checksum: "abc123",
      counts: { files: 2 },
    };
    const purged = await recordPurge(db, "ret-1", tombstone);
    expect(purged?.purged_at).not.toBeNull();
    expect(purged?.tombstone).toEqual(tombstone);

    // Now purged, it no longer appears as eligible.
    expect(await listPurgeEligible(db, asOf)).toEqual([]);
  });

  it("recordPurge on an unknown id returns null", async () => {
    expect(await recordPurge(db, "nope", {})).toBeNull();
  });
});
