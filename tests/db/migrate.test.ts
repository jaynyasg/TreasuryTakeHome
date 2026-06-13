import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgliteClient } from "@/lib/db/pglite";
import type { DbClient } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

describe("runMigrations", () => {
  let db: DbClient;

  beforeEach(async () => {
    db = await createPgliteClient();
  });

  afterEach(async () => {
    await db.close();
  });

  it("applies 0001_init on a fresh database", async () => {
    const applied = await runMigrations(db);
    expect(applied).toContain("0001_init.sql");
  });

  it("is idempotent: a second run applies nothing", async () => {
    await runMigrations(db);
    const second = await runMigrations(db);
    expect(second).toEqual([]);
  });

  it("creates core tables (batches is selectable)", async () => {
    await runMigrations(db);
    // A successful select proves the table exists; PGlite information_schema
    // support is uneven, so we probe by querying instead.
    const res = await db.query<{ count: number | string }>(
      "select count(*) as count from batches"
    );
    // PGlite returns count(*) as a JS number; node-pg returns a numeric string.
    // Normalize before asserting so the table-exists probe is driver-agnostic.
    expect(Number(res.rows[0].count)).toBe(0);
  });

  it("records the migration in _migrations", async () => {
    await runMigrations(db);
    const res = await db.query<{ name: string }>(
      "select name from _migrations where name = $1",
      ["0001_init.sql"]
    );
    expect(res.rows).toHaveLength(1);
  });
});
