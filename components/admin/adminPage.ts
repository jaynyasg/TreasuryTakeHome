import { requirePrincipal } from "@/lib/server/session";
import { requireAdmin } from "@/lib/server/admin";
import { NotAuthorizedError } from "@/lib/server/queries";
import { createPgPool } from "@/lib/db/pg";
import { getUserById } from "@/lib/db/repositories/users";
import type { Principal } from "@/lib/auth/authorize";

/**
 * Shared server-side admin-page guard + actor-label resolver (Stage 8 / T8).
 *
 * Every admin tab page calls this FIRST: it resolves the principal (redirecting
 * to /login when absent) and applies `requireAdmin`. A non-admin yields
 * `{ forbidden: true }` so the page renders the 403 view; an admin yields the
 * principal plus a friendly `actorLabel` (name/email, falling back to userId)
 * for the confirmation dialogs' audit envelope.
 *
 * The label lookup is best-effort and never blocks the page — any DB error
 * falls back to the userId. The pool is closed in a `finally`.
 */
export type AdminPageContext =
  | { forbidden: true }
  | { forbidden: false; principal: Principal; actorLabel: string };

export async function resolveAdminPage(): Promise<AdminPageContext> {
  const principal = await requirePrincipal();
  try {
    requireAdmin(principal);
  } catch (err) {
    if (err instanceof NotAuthorizedError) return { forbidden: true };
    throw err;
  }

  let actorLabel = principal.userId;
  const db = createPgPool();
  try {
    const user = await getUserById(db, principal.userId);
    if (user) actorLabel = user.name ?? user.email ?? principal.userId;
  } catch {
    // Cosmetic label lookup; fall back to the userId on any DB error.
  } finally {
    await db.close();
  }

  return { forbidden: false, principal, actorLabel };
}
