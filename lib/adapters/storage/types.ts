/**
 * Storage provider seam (plan "Provider boundaries"; preflight §2 Storage).
 *
 * Every raw upload, warning-evidence crop, and export artifact is read and
 * written through this interface so the Vercel Blob SDK stays at the edge and a
 * later object-store migration only swaps the adapter, not the call sites. The
 * object manifest in Postgres — not the blob store — is the source of truth for
 * object existence (plan "Storage consistency"); this adapter just moves bytes
 * and reports provider-side metadata.
 *
 * Worker-safe: no Next.js imports. The fake and the real adapter must satisfy
 * the same behavior contract (`contractTest.ts`, plan "Adapter contract tests").
 */

/** Provider-reported metadata for a stored object. */
export interface StorageObject {
  /** Object key / pathname within the store. */
  key: string;
  /** sha256 hex of the stored bytes (computed at the seam, provider-agnostic). */
  checksum: string;
  /** Size in bytes. */
  size: number;
  /** Stored content type. */
  contentType: string;
}

export interface StorageAdapter {
  /**
   * Store `data` at `key` with the given content type. Returns the object
   * metadata including a sha256 checksum and byte size, which the caller
   * persists in the object-manifest row.
   */
  put(
    key: string,
    data: Uint8Array,
    opts: { contentType: string }
  ): Promise<StorageObject>;

  /** Read the bytes + content type at `key`, or null when no object exists. */
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;

  /**
   * Issue a short-lived scoped URL for direct client access, valid for
   * `ttlSeconds`. Returns null when the provider cannot mint a properly scoped,
   * short-lived URL — in which case the caller MUST fall back to the
   * app-mediated proxy path (authorize, audit, stream the bytes itself). Never
   * persist a returned URL as durable evidence (preflight §2 Storage).
   */
  getSignedUrl(key: string, ttlSeconds: number): Promise<string | null>;

  /** Delete the object at `key`. Idempotent — deleting a missing key is a no-op. */
  delete(key: string): Promise<void>;

  /** List objects whose key starts with `prefix`, with their sizes. */
  list(prefix: string): Promise<{ key: string; size: number }[]>;
}
