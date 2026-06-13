import { notFound } from "next/navigation";
import { requirePrincipal } from "@/lib/server/session";
import { createPgPool } from "@/lib/db/pg";
import { getUserById } from "@/lib/db/repositories/users";
import AppShell from "@/components/app-shell/AppShell";

/**
 * Server layout for the entire reviewer/admin route group `(reviewer)`.
 *
 * The `(reviewer)` group is PATH-TRANSPARENT: it adds no URL segment. Real URLs
 * come from the nested folders — `app/(reviewer)/reviewer/...` → `/reviewer/...`
 * and `app/(reviewer)/admin/...` → `/admin/...`. This keeps the public take-home
 * core (`app/page.tsx` at `/`) entirely separate and visually unchanged; nothing
 * here touches `app/layout.tsx`.
 *
 * Flag gating: when `DURABLE_BATCH !== "1"` the whole reviewer/admin area
 * returns 404 (`notFound()`), so the production feature is invisible until
 * enabled — matching the edge `authorized` gate in `auth.config.ts`. When the
 * flag is on, `middleware.ts` has already enforced auth on `/reviewer` +
 * `/admin`; we additionally resolve the principal here (redirecting to /login if
 * somehow absent) and render the role-aware shell around the page.
 */
export const dynamic = "force-dynamic";

export default async function ReviewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (process.env.DURABLE_BATCH !== "1") {
    notFound();
  }

  const principal = await requirePrincipal();

  // Best-effort friendly label (name/email) for the header; never blocks render.
  let userLabel = principal.userId;
  const db = createPgPool();
  try {
    const user = await getUserById(db, principal.userId);
    if (user) userLabel = user.name ?? user.email ?? principal.userId;
  } catch {
    // Identity lookup is cosmetic; fall back to the userId on any DB error.
  } finally {
    await db.close();
  }

  return (
    <AppShell principal={principal} userLabel={userLabel}>
      {children}
    </AppShell>
  );
}
