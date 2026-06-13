/**
 * Stage 9 / T10+T11 — migration & rollback SAFETY checks (plan "Migration and
 * rollback tests": "add-only migration compatibility with old/new code
 * assumptions, feature-flag-off behavior, runtime kill switches, retention purge
 * preview, and smoke rollback path").
 *
 * The rollout posture is EXPAND-CONTRACT (plan "Rollout sequence" / "Rollback
 * Flow"): every migration is additive, so the new schema can ship and sit unused
 * behind the `DURABLE_BATCH` flag, and an old binary keeps running against it.
 * These tests encode that contract so a future migration that drops or renames a
 * column fails CI loudly instead of silently breaking flag-off rollback.
 *
 * All offline + deterministic: a fresh PGlite db, the real migration runner, and
 * static SQL inspection. No network, no provider SDK.
 */
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { createPgliteClient } from "@/lib/db/pglite";
import type { DbClient } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

const MIGRATIONS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../lib/db/migrations"
);

/** The ordered additive migration set under test (0001 -> 0004). */
const EXPECTED_MIGRATIONS = [
  "0001_init.sql",
  "0002_auth.sql",
  "0003_queue.sql",
  "0004_intake.sql",
];

async function migrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR);
  return entries.filter((f) => f.endsWith(".sql")).sort();
}

async function readMigration(name: string): Promise<string> {
  return readFile(join(MIGRATIONS_DIR, name), "utf8");
}

/** Tables a fresh, fully-migrated db must expose (the durable-batch schema). */
const EXPECTED_TABLES = [
  "users",
  "batches",
  "cases",
  "case_files",
  "processing_attempts",
  "extracted_fields",
  "verdicts",
  "warning_evidence",
  "dispositions",
  "assignments",
  "exports",
  "retention_state",
  "audit_events",
  "queue_jobs",
  "intake_sessions",
  "manifest_entries",
];

async function listPublicTables(db: DbClient): Promise<Set<string>> {
  const { rows } = await db.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'"
  );
  return new Set(rows.map((r) => r.tablename));
}

describe("migration & rollback safety", () => {
  let db: DbClient | null = null;

  afterEach(async () => {
    if (db) await db.close();
    db = null;
  });

  it("applies 0001 -> 0004 in order on a fresh db", async () => {
    db = await createPgliteClient();
    const applied = await runMigrations(db);

    // Exactly the expected additive set, applied in filename order.
    expect(applied).toEqual(EXPECTED_MIGRATIONS);

    // The actual on-disk set matches what the test expects (guards against a new
    // migration landing without this test being updated).
    expect(await migrationFiles()).toEqual(EXPECTED_MIGRATIONS);

    // The full durable-batch schema is present after migrating.
    const tables = await listPublicTables(db);
    for (const t of EXPECTED_TABLES) {
      expect(tables.has(t), `table ${t} should exist after migration`).toBe(true);
    }
  });

  it("is idempotent: re-running applies nothing", async () => {
    db = await createPgliteClient();
    await runMigrations(db);

    // A second run sees every migration already recorded in `_migrations` and
    // applies none — safe to call on every startup (expand-contract: deploying
    // the same schema twice is a no-op).
    const second = await runMigrations(db);
    expect(second).toEqual([]);

    // A third run is also a no-op (no drift accumulates).
    const third = await runMigrations(db);
    expect(third).toEqual([]);
  });

  it("every migration is ADD-ONLY (no drop/rename of existing schema)", async () => {
    // Expand-contract guarantee: an additive migration may CREATE tables/indexes
    // and ALTER ... ADD COLUMN, but must never drop or rename existing schema, so
    // an old binary (flag-off) keeps working against the new database. Any
    // destructive verb here would break flag-off rollback.
    const forbidden: { pattern: RegExp; label: string }[] = [
      { pattern: /\bdrop\s+table\b/i, label: "drop table" },
      { pattern: /\bdrop\s+column\b/i, label: "drop column" },
      { pattern: /\bdrop\s+index\b/i, label: "drop index" },
      { pattern: /\bdrop\s+constraint\b/i, label: "drop constraint" },
      { pattern: /\brename\s+to\b/i, label: "rename to" },
      { pattern: /\brename\s+column\b/i, label: "rename column" },
      { pattern: /\balter\s+column\b/i, label: "alter column" },
      { pattern: /\btruncate\b/i, label: "truncate" },
    ];

    for (const name of await migrationFiles()) {
      // Strip line + block comments so a verb mentioned in prose (e.g. the
      // header comments) is not mistaken for a real statement.
      const sql = stripSqlComments(await readMigration(name));
      for (const { pattern, label } of forbidden) {
        expect(
          pattern.test(sql),
          `${name} must not contain a '${label}' statement (additive/expand-contract only)`
        ).toBe(false);
      }
    }
  });

  it("only contains additive DDL verbs (create / alter-add)", async () => {
    // Positive form of the add-only rule: every ALTER TABLE in the set is an
    // ADD COLUMN (the only additive table mutation we permit). This catches a
    // destructive ALTER variant the forbidden-list above might not enumerate.
    for (const name of await migrationFiles()) {
      const sql = stripSqlComments(await readMigration(name));
      const alters = sql.match(/alter\s+table\s+[^;]*/gi) ?? [];
      for (const alter of alters) {
        expect(
          /add\s+column/i.test(alter),
          `${name}: every 'alter table' must be an 'add column' (got: ${alter.trim().slice(0, 80)})`
        ).toBe(true);
      }
    }
  });

  it("DURABLE_BATCH flag-off: the additive schema is present but unused (expand-contract posture)", async () => {
    // The migrations are pure DDL — they NEVER read DURABLE_BATCH and never write
    // rows. So a fresh migrate with the flag unset yields the full schema with
    // ZERO rows: the durable tables exist but nothing has been enqueued or
    // processed. This is the documented expand-contract posture — schema ships
    // first (flag off), then the flag enables the code that uses it.
    const original = process.env.DURABLE_BATCH;
    delete process.env.DURABLE_BATCH;
    try {
      db = await createPgliteClient();
      await runMigrations(db);
      expect(process.env.DURABLE_BATCH).toBeUndefined();

      // Durable tables that the flag-gated code would populate are present...
      const tables = await listPublicTables(db);
      expect(tables.has("batches")).toBe(true);
      expect(tables.has("queue_jobs")).toBe(true);
      expect(tables.has("intake_sessions")).toBe(true);

      // ...but empty, because no durable-batch code ran. Schema is dormant until
      // the flag turns on the intake/worker paths.
      for (const t of ["batches", "cases", "queue_jobs", "intake_sessions"]) {
        const { rows } = await db.query<{ count: string }>(
          `select count(*)::text as count from ${t}`
        );
        expect(Number(rows[0].count), `${t} should be empty with flag off`).toBe(0);
      }
    } finally {
      if (original === undefined) delete process.env.DURABLE_BATCH;
      else process.env.DURABLE_BATCH = original;
    }
  });
});

/** Remove `-- line` and block comments so prose verbs aren't matched as SQL. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/--[^\n]*/g, " "); // line comments
}
