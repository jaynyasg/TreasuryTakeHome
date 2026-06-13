import { redirect } from "next/navigation";
import { auth } from "@/auth";
import type { Principal, Role } from "@/lib/auth/authorize";

/**
 * Server-only session helpers for the reviewer/admin app (Stage 7 / T7).
 *
 * Bridges the Auth.js session (`auth()` → `session.user.{userId,role}`, stamped
 * by the jwt/session callbacks in `auth.ts`) to the `Principal` shape the
 * authorization core (`lib/auth/authorize.ts`) and the server query layer
 * (`lib/server/queries.ts`) consume.
 *
 * Server-only by construction: importing `@/auth` pulls the Node-runtime
 * Credentials provider + `pg`, so this module can never be bundled into a client
 * component. (The `server-only` marker package isn't a project dependency, so we
 * rely on that transitive Node-only graph instead of adding one.)
 */

/** Valid roles, mirrored from the authorization core's `Role` union. */
const ROLES: ReadonlySet<Role> = new Set<Role>(["reviewer", "admin"]);

function isRole(value: unknown): value is Role {
  return typeof value === "string" && ROLES.has(value as Role);
}

/**
 * Resolve the current request's principal, or `null` when there is no valid
 * authenticated session. Parse-or-null at the seam: a session missing `userId`
 * or carrying an unexpected `role` yields `null` rather than a malformed
 * principal, so callers never authorize against a half-built identity.
 */
export async function getPrincipal(): Promise<Principal | null> {
  const session = await auth();
  const user = session?.user;
  if (!user) return null;

  const userId = user.userId;
  const role = user.role;
  if (typeof userId !== "string" || userId.length === 0) return null;
  if (!isRole(role)) return null;

  return { userId, role };
}

/**
 * Like {@link getPrincipal} but redirects to the sign-in page when absent.
 * Use in server components/actions that require an authenticated reviewer or
 * admin. The `redirect()` throws, so the return type is the non-null principal.
 */
export async function requirePrincipal(): Promise<Principal> {
  const principal = await getPrincipal();
  if (!principal) {
    redirect("/login");
  }
  return principal;
}
