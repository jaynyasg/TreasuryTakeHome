/**
 * Edge middleware that applies the Auth.js `authorized` route gate.
 *
 * It instantiates NextAuth with ONLY the edge-safe `authConfig` (no DB-backed
 * Credentials provider, no `pg`/`node:crypto`), so the middleware bundle stays
 * edge-compatible. Auth decisions for `/reviewer` and `/admin` are made by
 * `authConfig.callbacks.authorized`.
 *
 * The `matcher` is scoped to `/reviewer` and `/admin` only, so the public
 * take-home core (`/`, `/api/verify`, `/api/extract-application`, the generator)
 * is NEVER intercepted — even before the `DURABLE_BATCH` flag check runs. When
 * the flag is off, `authorized` additionally returns `true` for everything, so
 * these matched paths are a no-op until durable batch is enabled.
 */
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export const { auth: middleware } = NextAuth(authConfig);

export const config = {
  matcher: ["/reviewer/:path*", "/admin/:path*"],
};
