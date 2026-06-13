import { Pool } from "pg";
import type { DbClient, Queryable } from "./client";

/**
 * Production database client backed by a `pg` connection pool.
 *
 * Per the Stage-1 preflight decision (`docs/designs/stage-1-preflight.md`):
 *   - Vercel serverless functions connect through the provider's pooled
 *     (pgbouncer-style) endpoint — pass that connection string here.
 *   - The worker uses a small fixed pool (default ~10) against the direct or
 *     pooled endpoint.
 *
 * This file is the production path. It must typecheck but is not exercised by
 * the offline PGlite test suite (no live Postgres in CI/`verify`).
 */
export function createPgPool(connectionString?: string): DbClient {
  const pool = new Pool({
    connectionString: connectionString ?? process.env.DATABASE_URL,
  });

  return {
    async query<R = unknown>(sql: string, params?: readonly unknown[]) {
      const res = await pool.query(sql, params ? [...params] : undefined);
      return { rows: res.rows as R[] };
    },

    async exec(sql: string): Promise<void> {
      // No params => simple query protocol, which accepts multiple statements.
      await pool.query(sql);
    },

    async transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Queryable = {
          async query<R = unknown>(sql: string, params?: readonly unknown[]) {
            const res = await client.query(
              sql,
              params ? [...params] : undefined
            );
            return { rows: res.rows as R[] };
          },
          async exec(execSql: string): Promise<void> {
            await client.query(execSql);
          },
        };
        const result = await fn(tx);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async close(): Promise<void> {
      await pool.end();
    },
  };
}
