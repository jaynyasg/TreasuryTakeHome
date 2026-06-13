import { createHash } from "node:crypto";
import { del, get, list, put } from "@vercel/blob";
import type { StorageAdapter, StorageObject } from "./types";

/**
 * Vercel Blob {@link StorageAdapter} (preflight §2 Storage). Production path:
 * raw uploads, warning-evidence crops, and export artifacts. The Vercel Blob
 * SDK is confined to this edge file; the rest of the app talks to
 * {@link StorageAdapter} only.
 *
 * This file is the production path. It must typecheck but is NOT exercised by
 * the offline test suite (no live Blob store in `verify`) — the fake adapter
 * carries the behavior contract there.
 *
 * Objects are stored with `access: "private"` so they are not world-readable by
 * URL; reads go back through {@link get} with the read-write token.
 */
export function createVercelBlobStorage(): StorageAdapter {
  return {
    async put(
      key: string,
      data: Uint8Array,
      opts: { contentType: string }
    ): Promise<StorageObject> {
      await put(key, Buffer.from(data), {
        access: "private",
        contentType: opts.contentType,
        // Manifest row owns the key; overwriting the same key must replace, not
        // append a random suffix (plan "Storage consistency").
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return {
        key,
        checksum: sha256Hex(data),
        size: data.byteLength,
        contentType: opts.contentType,
      };
    },

    async get(
      key: string
    ): Promise<{ data: Uint8Array; contentType: string } | null> {
      const res = await get(key, { access: "private" });
      // null => not found; statusCode 304 has a null stream (only happens with a
      // conditional request, which we never send) — treat both as "no bytes".
      if (!res || res.statusCode !== 200) return null;
      const data = await readStream(res.stream);
      return { data, contentType: res.blob.contentType };
    },

    async getSignedUrl(): Promise<string | null> {
      // Vercel Blob URLs are not short-lived-scoped to a reviewer + audited
      // access; a public URL leaks the object for as long as it exists, and a
      // private blob URL still isn't a time-boxed signed grant. Per the preflight
      // doc (`docs/designs/stage-1-preflight.md` §2 Storage, "Private /
      // signed-access plan limits"), when short-lived signed URLs can't meet the
      // authorization-scoping + audit requirement we return null so the caller
      // takes the documented app-mediated download/proxy fallback: authorize,
      // emit the access audit event, then stream the bytes. Signed URLs are never
      // stored as durable evidence.
      return null;
    },

    async delete(key: string): Promise<void> {
      // `del` is idempotent against a missing key.
      await del(key);
    },

    async list(prefix: string): Promise<{ key: string; size: number }[]> {
      const out: { key: string; size: number }[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix, cursor });
        for (const blob of page.blobs) {
          out.push({ key: blob.pathname, size: blob.size });
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return out;
    },
  };
}

async function readStream(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
