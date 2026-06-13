/**
 * Edge-safe Auth.js configuration (the part the middleware can run on the edge).
 *
 * MUST NOT import the database, the `pg` SDK, or `node:crypto` — middleware runs
 * in the edge runtime. The Credentials provider and its DB-backed `authorize`
 * live in `auth.ts` (Node runtime) instead; this file only carries `pages` and
 * the `authorized` route-gating callback.
 *
 * Gating is behind the `DURABLE_BATCH` feature flag (plan: "durable batch ships
 * behind a feature flag"). When the flag is off, `authorized` allows everything,
 * so the public take-home core (`/`, `/api/verify`, `/api/extract-application`,
 * the generator) is never intercepted. The middleware matcher is additionally
 * scoped to `/reviewer` and `/admin` only.
 */
import type { NextAuthConfig } from "next-auth";

/** Durable-batch auth gating is opt-in via env flag. Off => middleware no-op. */
function durableBatchEnabled(): boolean {
  return process.env.DURABLE_BATCH === "1";
}

export const authConfig: NextAuthConfig = {
  pages: {
    signIn: "/login",
  },
  providers: [],
  callbacks: {
    /**
     * Route gate invoked by the middleware. Returning `true` allows the request;
     * `false` redirects unauthenticated users to the sign-in page.
     */
    authorized({ auth, request }) {
      // Flag off: never gate. Public core stays open and unauthenticated.
      if (!durableBatchEnabled()) return true;

      const { pathname } = request.nextUrl;
      const isReviewerArea = pathname.startsWith("/reviewer");
      const isAdminArea = pathname.startsWith("/admin");

      // Anything outside the gated areas is public even when the flag is on.
      if (!isReviewerArea && !isAdminArea) return true;

      const role = auth?.user?.role;
      if (!role) return false; // not signed in -> redirect to /login

      // Admin area is admin-only; reviewer area allows reviewer or admin.
      if (isAdminArea) return role === "admin";
      return true;
    },
  },
};
