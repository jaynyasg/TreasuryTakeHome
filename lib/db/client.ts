/**
 * Driver-agnostic database seam.
 *
 * This is the single boundary every persistence module talks to, so the same
 * repository code runs against PGlite (tests, in-process) and `pg` Pool
 * (production) without change.
 *
 * Composition rule (see plan "Transaction ownership"):
 *   - Aggregate **repositories** accept a `Queryable`. They never open or commit
 *     transactions themselves, so they compose freely inside a larger unit of
 *     work — call them with the top-level client OR with a transaction context.
 *   - **Service-command** modules own `transaction()` orchestration: a state
 *     change and its append-only audit event commit in the same unit of work.
 *
 * Worker-safe: no Next.js imports, no provider SDK types leak through this file.
 */

/** Anything that can run a parameterized SQL query. Both the top-level client
 *  and a transaction context satisfy this, which is what lets repositories
 *  compose inside `transaction()`. */
export interface Queryable {
  query<R = unknown>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<{ rows: R[] }>;
  /**
   * Run one or more semicolon-separated statements with NO parameters, via the
   * simple (non-prepared) protocol. Use this for migration DDL bodies: the
   * parameterized `query()` path runs a single prepared statement and rejects
   * multi-statement SQL ("cannot insert multiple commands into a prepared
   * statement"). Never interpolate untrusted input here — it has no params.
   */
  exec(sql: string): Promise<void>;
}

/** A full database client: a `Queryable` plus transaction orchestration and a
 *  lifecycle `close()`. Service-command modules depend on this; repositories
 *  depend only on `Queryable`. */
export interface DbClient extends Queryable {
  /**
   * Run `fn` inside a single transaction. The `tx` handed to `fn` is a
   * `Queryable` bound to that transaction; pass it to repositories so every
   * write commits or rolls back together. Throwing from `fn` rolls back.
   */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** Release underlying resources (pool / in-process engine). */
  close(): Promise<void>;
}
