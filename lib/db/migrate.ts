import { readdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DbClient } from "./client";

/** Directory holding `NNNN_name.sql` migration files, resolved relative to this
 *  module so it works from source, from `tsx`, and under Vitest. */
function defaultMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return resolve(here, "migrations");
}

/**
 * Apply any pending SQL migrations from `dir` (default `lib/db/migrations/`).
 *
 * Migrations are plain `*.sql` files applied in filename order. Each runs inside
 * its own transaction together with the bookkeeping insert into `_migrations`,
 * so a half-applied migration cannot be recorded as done. Already-recorded
 * migrations are skipped, making this safe to call on every startup.
 *
 * Returns the names that were applied on THIS call (empty when up to date).
 */
export async function runMigrations(
  client: DbClient,
  dir?: string
): Promise<string[]> {
  const migrationsDir = dir ?? defaultMigrationsDir();

  await client.query(
    `create table if not exists _migrations (
       name text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const entries = await readdir(migrationsDir);
  const files = entries.filter((f) => f.endsWith(".sql")).sort();

  const recorded = await client.query<{ name: string }>(
    "select name from _migrations"
  );
  const done = new Set(recorded.rows.map((r) => r.name));

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(migrationsDir, file), "utf8");
    await client.transaction(async (tx) => {
      // Migration bodies are multi-statement DDL: use `exec` (simple protocol),
      // not the parameterized `query` (single prepared statement).
      await tx.exec(sql);
      await tx.query("insert into _migrations (name) values ($1)", [file]);
    });
    applied.push(file);
  }

  return applied;
}
