import { createPgliteClient } from "@/lib/db/pglite";
import type { DbClient } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

// PGlite spins up a WASM Postgres instance per client. Creating a fresh one per
// test cold-starts dozens of instances under Vitest's parallel workers, which
// thrashes CPU and blows past hook timeouts on slower machines. Instead we keep
// ONE migrated instance per worker process and truncate all tables between
// acquisitions to restore isolation cheaply. close() is made a no-op on the
// handed-out handle so a test's afterEach teardown can't destroy the shared
// instance the next test depends on.
let shared: DbClient | null = null;
let booting: Promise<DbClient> | null = null;

async function getShared(): Promise<DbClient> {
  if (shared) return shared;
  if (!booting) {
    booting = (async () => {
      const db = await createPgliteClient();
      await runMigrations(db);
      shared = db;
      return db;
    })();
  }
  return booting;
}

async function truncateAll(db: DbClient): Promise<void> {
  const { rows } = await db.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> '_migrations'"
  );
  if (rows.length === 0) return;
  const list = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.exec(`truncate ${list} restart identity cascade;`);
}

/** Returns a migrated in-memory PGlite client with all tables truncated to a
 *  clean state. Reuses one WASM instance per worker to avoid cold-start thrash;
 *  the returned handle's close() is a no-op so the shared instance survives
 *  per-test teardown. */
export async function migratedClient(): Promise<DbClient> {
  const db = await getShared();
  await truncateAll(db);
  return new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "close") {
        return async () => {
          /* no-op: shared instance is reused across tests */
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as DbClient;
}

let userSeq = 0;

/** Insert a user and return its id. Email is unique per call (the counter is
 *  not reset by truncation, so emails stay unique across tests). */
export async function seedUser(
  db: DbClient,
  role: "reviewer" | "admin" = "reviewer"
): Promise<string> {
  const id = `user-${++userSeq}`;
  await db.query(
    "insert into users (id, email, name, role) values ($1, $2, $3, $4)",
    [id, `${id}@example.test`, `User ${id}`, role]
  );
  return id;
}
