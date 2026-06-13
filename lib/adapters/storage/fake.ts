import { createHash } from "node:crypto";
import type { StorageAdapter, StorageObject } from "./types";

/**
 * In-memory {@link StorageAdapter} for tests and local runs (plan "Adapter
 * contract tests"). Backed by a `Map`, no I/O, worker-safe.
 *
 * `getSignedUrl` always returns null so the test suite exercises the
 * app-mediated proxy fallback (the path real production takes — Vercel Blob
 * public URLs are not short-lived-scoped; see `vercelBlob.ts`). This keeps the
 * authorize-then-proxy-then-audit path the default everywhere.
 */
export function createFakeStorage(): StorageAdapter {
  const store = new Map<string, { data: Uint8Array; contentType: string }>();

  return {
    async put(
      key: string,
      data: Uint8Array,
      opts: { contentType: string }
    ): Promise<StorageObject> {
      // Copy so later mutation of the caller's buffer can't change stored bytes.
      const bytes = Uint8Array.from(data);
      store.set(key, { data: bytes, contentType: opts.contentType });
      return {
        key,
        checksum: sha256Hex(bytes),
        size: bytes.byteLength,
        contentType: opts.contentType,
      };
    },

    async get(
      key: string
    ): Promise<{ data: Uint8Array; contentType: string } | null> {
      const hit = store.get(key);
      if (!hit) return null;
      // Hand back a copy so callers can't mutate the backing store.
      return { data: Uint8Array.from(hit.data), contentType: hit.contentType };
    },

    async getSignedUrl(): Promise<string | null> {
      // Force the app-mediated proxy path (see file-level comment).
      return null;
    },

    async delete(key: string): Promise<void> {
      store.delete(key);
    },

    async list(prefix: string): Promise<{ key: string; size: number }[]> {
      const out: { key: string; size: number }[] = [];
      for (const [key, value] of store) {
        if (key.startsWith(prefix)) {
          out.push({ key, size: value.data.byteLength });
        }
      }
      return out;
    },
  };
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
