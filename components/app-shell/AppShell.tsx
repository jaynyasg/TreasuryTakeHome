import { type ReactNode } from "react";
import Link from "next/link";
import { signOut } from "@/auth";
import type { Principal } from "@/lib/auth/authorize";
import RoleNav from "./RoleNav";

/**
 * Persistent operational shell for authenticated reviewers/admins (Stage 7/T7).
 *
 * A calm, technical, table-first workbench — NOT a marketing dashboard. Layout:
 *   - a header with the product mark, the signed-in user + role, and sign-out;
 *   - a role-aware left nav (`<nav>`), top-bar on narrow viewports;
 *   - a `<main>` content region with semantic landmarks.
 *
 * Accessibility: a skip link to main, 44px touch targets, visible focus rings,
 * and ≥4.5:1 text contrast via house-style ink/muted tokens. Honors the
 * Anti-Generic UI Constraints (utility copy, no decorative hero/gradients).
 *
 * Server component: renders the Auth.js `signOut` server action inline.
 */
export default function AppShell({
  principal,
  userLabel,
  children,
}: {
  principal: Principal;
  /** Display name or email for the signed-in user; falls back to userId. */
  userLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-canvas">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-ink focus:px-3 focus:py-2 focus:text-[13px] focus:text-white"
      >
        Skip to content
      </a>

      <header className="border-b border-line bg-card">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <Link
              href="/reviewer/queue"
              className="flex items-center gap-2 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
                TTB
              </span>
              <span className="text-[14px] font-semibold tracking-tight text-ink">
                Label Review
              </span>
            </Link>
            <span className="hidden rounded-pill border border-line bg-surface px-2 py-[3px] text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted sm:inline">
              {principal.role}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <span
              className="hidden max-w-[40ch] truncate text-[12.5px] text-muted sm:inline"
              title={userLabel}
            >
              {userLabel}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/login" });
              }}
            >
              <button
                type="submit"
                className="inline-flex min-h-[36px] items-center rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-7xl flex-col gap-0 md:flex-row">
        <nav
          aria-label="Primary"
          className="shrink-0 border-b border-line px-3 py-3 md:w-56 md:border-b-0 md:border-r md:py-5"
        >
          <RoleNav role={principal.role} />
        </nav>

        <main id="main" className="min-w-0 flex-1 px-4 py-5 md:px-6">
          {children}
        </main>
      </div>
    </div>
  );
}
