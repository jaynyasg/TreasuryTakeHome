/**
 * Password hashing for the Credentials provider.
 *
 * Uses Node's built-in `node:crypto` scrypt — deliberately NO bcrypt/argon2
 * native dependency, so the worker-safe core and the test suite build on any
 * platform without a compile step.
 *
 * Stored format: `scrypt$<saltHex>$<hashHex>`. The salt is random per hash, so
 * two hashes of the same password differ. Verification is timing-safe via
 * `crypto.timingSafeEqual`.
 *
 * Pure: no I/O, no Next.js imports. Safe to import from anywhere.
 */
import {
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number
) => Promise<Buffer>;

/** Derived-key length in bytes. */
const KEY_LEN = 64;
/** Random salt length in bytes. */
const SALT_LEN = 16;

/** Hash a plaintext password into the `scrypt$<saltHex>$<hashHex>` format. */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const derived = await scrypt(plain, salt, KEY_LEN);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/**
 * Verify `plain` against a `stored` hash. Returns false (never throws) for any
 * malformed stored string — unknown scheme, wrong segment count, or non-hex
 * payload — so a corrupt DB row degrades to "wrong password" rather than a 500.
 */
export async function verifyPassword(
  plain: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 3) return false;
  const [scheme, saltHex, hashHex] = parts;
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, "hex");
    expected = Buffer.from(hashHex, "hex");
  } catch {
    return false;
  }
  // Buffer.from("...", "hex") silently drops invalid chars rather than throwing;
  // guard the recovered lengths so a malformed payload can't slip through.
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false;

  const actual = await scrypt(plain, salt, KEY_LEN);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
