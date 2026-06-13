import { redirect } from "next/navigation";
import { requirePrincipal } from "@/lib/server/session";

/**
 * Role landing entry at `/reviewer`.
 *
 * Reviewers land on the Work Queue; admins land on the Operations console
 * (plan: "Reviewers land on Work Queue; admins land on Operations Health").
 * Placed here (not at the `(reviewer)` group root) so its URL is `/reviewer` and
 * it never collides with the public core's `app/page.tsx` at `/`.
 */
export default async function ReviewerLanding() {
  const principal = await requirePrincipal();
  redirect(principal.role === "admin" ? "/admin" : "/reviewer/queue");
}
