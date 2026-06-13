/**
 * Demo/staging user seeding (plan: "seeded reviewer/admin users for demo and
 * staging"). Idempotent: re-running upserts the same two users, refreshing their
 * password hash from env so a rotated demo password takes effect on re-seed.
 *
 * Passwords come from env (`SEED_REVIEWER_PASSWORD` / `SEED_ADMIN_PASSWORD`)
 * with dev-only defaults. NEVER rely on the defaults in a real deployment.
 *
 * Not run during `npm run verify` — invoked only via `npm run seed`
 * (scripts/seed.ts) against a real Postgres.
 */
import type { DbClient } from "@/lib/db/client";
import { hashPassword } from "@/lib/auth/password";

/** Dev-only fallback passwords. Override via env in any shared environment. */
const DEFAULT_REVIEWER_PASSWORD = "reviewer-dev-password";
const DEFAULT_ADMIN_PASSWORD = "admin-dev-password";

interface SeedUserSpec {
  id: string;
  email: string;
  name: string;
  role: "reviewer" | "admin";
  password: string;
}

/**
 * Upsert the demo reviewer and admin. Idempotent via `on conflict (email)`:
 * existing rows keep their id but get name/role/password_hash refreshed.
 */
export async function seedUsers(db: DbClient): Promise<void> {
  const specs: SeedUserSpec[] = [
    {
      id: "seed-reviewer",
      email: "reviewer@ttb.gov",
      name: "Demo Reviewer",
      role: "reviewer",
      password: process.env.SEED_REVIEWER_PASSWORD ?? DEFAULT_REVIEWER_PASSWORD,
    },
    {
      id: "seed-admin",
      email: "admin@ttb.gov",
      name: "Demo Admin",
      role: "admin",
      password: process.env.SEED_ADMIN_PASSWORD ?? DEFAULT_ADMIN_PASSWORD,
    },
  ];

  for (const spec of specs) {
    const passwordHash = await hashPassword(spec.password);
    await db.query(
      `insert into users (id, email, name, role, password_hash)
       values ($1, $2, $3, $4, $5)
       on conflict (email) do update
         set name = excluded.name,
             role = excluded.role,
             password_hash = excluded.password_hash`,
      [spec.id, spec.email, spec.name, spec.role, passwordHash]
    );
  }
}
