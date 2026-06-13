import type { Queryable } from "@/lib/db/client";

/** Auth role; mirrors the CHECK constraint on users.role (0001_init.sql). */
export type UserRole = "reviewer" | "admin";

/** A row from the `users` table (including the password_hash added in 0002). */
export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  password_hash: string | null;
  created_at: string;
}

/** Fields accepted when inserting a user. */
export interface InsertUserInput {
  id: string;
  email: string;
  name?: string | null;
  role: UserRole;
  passwordHash?: string | null;
}

/**
 * Repository for the `users` aggregate. Each function takes a `Queryable` first
 * so it composes inside a service-owned `transaction()` (plan: "Transaction
 * ownership"). No transactions are opened here; all queries are parameterized.
 */

export async function getUserByEmail(
  db: Queryable,
  email: string
): Promise<UserRow | null> {
  const res = await db.query<UserRow>(
    "select * from users where email = $1",
    [email]
  );
  return res.rows[0] ?? null;
}

export async function getUserById(
  db: Queryable,
  id: string
): Promise<UserRow | null> {
  const res = await db.query<UserRow>("select * from users where id = $1", [id]);
  return res.rows[0] ?? null;
}

export async function insertUser(
  db: Queryable,
  input: InsertUserInput
): Promise<UserRow> {
  const res = await db.query<UserRow>(
    `insert into users (id, email, name, role, password_hash)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [
      input.id,
      input.email,
      input.name ?? null,
      input.role,
      input.passwordHash ?? null,
    ]
  );
  return res.rows[0];
}

/** List all users, most-recently-created first. */
export async function listUsers(db: Queryable): Promise<UserRow[]> {
  const res = await db.query<UserRow>(
    "select * from users order by created_at desc"
  );
  return res.rows;
}
