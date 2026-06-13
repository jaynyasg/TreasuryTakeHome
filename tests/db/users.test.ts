import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import {
  getUserByEmail,
  getUserById,
  insertUser,
  listUsers,
} from "@/lib/db/repositories/users";
import { migratedClient } from "./helpers";

describe("users repository", () => {
  let db: DbClient;

  beforeEach(async () => {
    // migratedClient runs ALL migrations including 0002_auth (password_hash).
    db = await migratedClient();
  });

  afterEach(async () => {
    await db.close();
  });

  it("applied the 0002 migration (password_hash column exists)", async () => {
    // Insert with a password_hash; if 0002 hadn't run this would error.
    const row = await insertUser(db, {
      id: "u-mig",
      email: "mig@ttb.gov",
      role: "reviewer",
      passwordHash: "scrypt$aa$bb",
    });
    expect(row.password_hash).toBe("scrypt$aa$bb");
  });

  it("inserts and reads a user back by email and by id", async () => {
    const inserted = await insertUser(db, {
      id: "u-1",
      email: "reviewer@ttb.gov",
      name: "Demo Reviewer",
      role: "reviewer",
      passwordHash: "scrypt$ff$ee",
    });
    expect(inserted.id).toBe("u-1");
    expect(inserted.role).toBe("reviewer");

    const byEmail = await getUserByEmail(db, "reviewer@ttb.gov");
    expect(byEmail?.id).toBe("u-1");
    expect(byEmail?.password_hash).toBe("scrypt$ff$ee");

    const byId = await getUserById(db, "u-1");
    expect(byId?.email).toBe("reviewer@ttb.gov");
  });

  it("returns null for an unknown email or id", async () => {
    expect(await getUserByEmail(db, "nobody@ttb.gov")).toBeNull();
    expect(await getUserById(db, "missing")).toBeNull();
  });

  it("lists inserted users", async () => {
    await insertUser(db, { id: "a", email: "a@ttb.gov", role: "reviewer" });
    await insertUser(db, { id: "b", email: "b@ttb.gov", role: "admin" });
    const users = await listUsers(db);
    expect(users.map((u) => u.id).sort()).toEqual(["a", "b"]);
  });

  it("rejects an invalid role (CHECK constraint)", async () => {
    await expect(
      db.query(
        "insert into users (id, email, role) values ($1, $2, $3)",
        ["u-bad", "bad@ttb.gov", "superuser"]
      )
    ).rejects.toThrow();
  });
});
