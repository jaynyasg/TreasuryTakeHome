import { createPgliteClient } from "@/lib/db/pglite";
import type { DbClient } from "@/lib/db/client";
import { runMigrations } from "@/lib/db/migrate";

/** Build a fresh in-memory PGlite client with all migrations applied. Each call
 *  is an isolated database, so tests don't share state. Caller closes it. */
export async function migratedClient(): Promise<DbClient> {
  const db = await createPgliteClient();
  await runMigrations(db);
  return db;
}

let userSeq = 0;

/** Insert a user and return its id. Email is unique per call. */
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
