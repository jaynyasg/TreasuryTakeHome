import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { StorageAdapter } from "./types";

/**
 * Shared behavior contract for {@link StorageAdapter} (plan "Adapter contract
 * tests"): both the in-memory fake and the real Vercel Blob adapter must
 * satisfy the same semantics for round-trip, missing objects, metadata, delete,
 * and prefix listing. Call once per adapter from a `*.test.ts` file.
 *
 * `makeAdapter` is invoked per test so each case gets a clean store.
 */
export function runStorageContract(
  name: string,
  makeAdapter: () => Promise<StorageAdapter> | StorageAdapter
): void {
  describe(`StorageAdapter contract: ${name}`, () => {
    const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
    const sha256Hex = (data: Uint8Array): string =>
      createHash("sha256").update(data).digest("hex");

    it("round-trips bytes with correct checksum and size on put", async () => {
      const storage = await makeAdapter();
      const data = bytes("hello world");

      const meta = await storage.put("docs/a.txt", data, {
        contentType: "text/plain",
      });
      expect(meta.key).toBe("docs/a.txt");
      expect(meta.size).toBe(data.byteLength);
      expect(meta.contentType).toBe("text/plain");
      expect(meta.checksum).toBe(sha256Hex(data));

      const got = await storage.get("docs/a.txt");
      expect(got).not.toBeNull();
      expect(got?.contentType).toBe("text/plain");
      expect(got ? Array.from(got.data) : null).toEqual(Array.from(data));
    });

    it("returns null when getting a missing key", async () => {
      const storage = await makeAdapter();
      expect(await storage.get("does/not/exist")).toBeNull();
    });

    it("delete removes an object", async () => {
      const storage = await makeAdapter();
      await storage.put("k/gone.bin", bytes("bye"), {
        contentType: "application/octet-stream",
      });
      expect(await storage.get("k/gone.bin")).not.toBeNull();

      await storage.delete("k/gone.bin");
      expect(await storage.get("k/gone.bin")).toBeNull();
    });

    it("delete is idempotent for a missing key", async () => {
      const storage = await makeAdapter();
      await expect(storage.delete("never/there")).resolves.toBeUndefined();
    });

    it("lists objects by prefix with sizes", async () => {
      const storage = await makeAdapter();
      const a = bytes("aaaa");
      const b = bytes("bb");
      const other = bytes("zzzzzz");
      await storage.put("batch-1/app.pdf", a, { contentType: "application/pdf" });
      await storage.put("batch-1/label.png", b, { contentType: "image/png" });
      await storage.put("batch-2/app.pdf", other, {
        contentType: "application/pdf",
      });

      const listed = await storage.list("batch-1/");
      const byKey = new Map(listed.map((o) => [o.key, o.size]));
      expect(byKey.get("batch-1/app.pdf")).toBe(a.byteLength);
      expect(byKey.get("batch-1/label.png")).toBe(b.byteLength);
      expect(byKey.has("batch-2/app.pdf")).toBe(false);
    });
  });
}
