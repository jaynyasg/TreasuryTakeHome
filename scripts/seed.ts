/**
 * Seed demo reviewer/admin users into the real Postgres pointed at by
 * `DATABASE_URL`. Builds a `pg` pool, applies migrations (so 0002's
 * password_hash column exists), then upserts the demo users.
 *
 * Run: npm run seed   (requires DATABASE_URL; respects SEED_*_PASSWORD env)
 *
 * NOT part of `npm run verify` — touches a live database.
 */
import { createPgPool } from "@/lib/db/pg";
import { runMigrations } from "@/lib/db/migrate";
import { seedUsers } from "@/lib/db/seed";

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required to seed users.");
  }
  const db = createPgPool();
  try {
    await runMigrations(db);
    await seedUsers(db);
    console.log("Seeded demo users: reviewer@ttb.gov, admin@ttb.gov");
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
