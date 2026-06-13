import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

describe("password hashing (scrypt)", () => {
  it("round-trips: a hash verifies against its plaintext", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse battery staple", hash)).toBe(
      true
    );
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("s3cret");
    expect(await verifyPassword("not-the-password", hash)).toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("same-input");
    const b = await hashPassword("same-input");
    expect(a).not.toBe(b);
    // ...but both still verify.
    expect(await verifyPassword("same-input", a)).toBe(true);
    expect(await verifyPassword("same-input", b)).toBe(true);
  });

  it("returns false (no throw) for malformed stored strings", async () => {
    for (const bad of [
      "",
      "not-a-hash",
      "scrypt$onlytwo",
      "bcrypt$abc$def", // unknown scheme
      "scrypt$$", // empty segments
      "scrypt$zz$zz", // non-hex payload
      "scrypt$deadbeef$cafe", // wrong salt/key lengths
    ]) {
      await expect(verifyPassword("whatever", bad)).resolves.toBe(false);
    }
  });
});
