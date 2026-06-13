import { PGlite } from "@electric-sql/pglite";
import type { DbClient, Queryable } from "./client";

/**
 * In-process Postgres for tests and local development, backed by PGlite.
 *
 * Runs entirely in-memory with no external server, which is what lets the
 * `tests/db/*` suite execute under `npm run verify` fully offline. The public
 * surface is the same `DbClient` the production `pg` pool exposes, so
 * repositories cannot tell the two apart.
 */
export async function createPgliteClient(): Promise<DbClient> {
  const db = new PGlite();
  // Force initialization so the first real query doesn't race startup.
  await db.query("select 1");

  return {
    async query<R = unknown>(sql: string, params?: readonly unknown[]) {
      const res = await db.query<R>(sql, params ? [...params] : undefined);
      return { rows: res.rows };
    },

    async exec(sql: string): Promise<void> {
      // `exec` uses the simple protocol and accepts multiple statements.
      await db.exec(sql);
    },

    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      return db.transaction(async (tx) => {
        const adapted: Queryable = {
          async query<R = unknown>(sql: string, params?: readonly unknown[]) {
            const res = await tx.query<R>(sql, params ? [...params] : undefined);
            return { rows: res.rows };
          },
          async exec(execSql: string): Promise<void> {
            await tx.exec(execSql);
          },
        };
        return fn(adapted);
      });
    },

    async close(): Promise<void> {
      await db.close();
    },
  };
}
