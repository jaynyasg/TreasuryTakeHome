"use client";

import { useActionState } from "react";
import Link from "next/link";
import { loginAction, type LoginState } from "./actions";

/**
 * Sign-in screen (`/login`), referenced by `auth.config.ts` pages.signIn.
 *
 * Deliberately dead-simple for non-technical reviewers (R4): two clearly-labeled
 * inputs, one primary button, and a single plain-language error on failure. Lives
 * OUTSIDE the `(reviewer)` route group so it is reachable while unauthenticated,
 * and links back to the public take-home tool. House-style throughout.
 *
 * The form posts to the `loginAction` server action, which calls
 * `signIn('credentials', ...)`; success redirects to `/reviewer` (role-routed).
 */
const INITIAL: LoginState = {};

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, INITIAL);

  return (
    <main className="grid min-h-screen place-items-center px-5 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
            TTB · Label Review
          </div>
          <h1 className="mt-1 text-xl font-semibold tracking-tight text-ink">
            Sign in
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            Reviewer and admin access to the label-verification workspace.
          </p>
        </div>

        <form
          action={action}
          className="flex flex-col gap-3 rounded-card border border-line bg-card p-5 shadow-card"
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="email" className="text-[12.5px] font-medium text-ink-2">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="min-h-[44px] rounded-lg border border-line bg-canvas px-3 text-[14px] text-ink outline-none transition focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="password"
              className="text-[12.5px] font-medium text-ink-2"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="min-h-[44px] rounded-lg border border-line bg-canvas px-3 text-[14px] text-ink outline-none transition focus-visible:border-accent/50 focus-visible:ring-2 focus-visible:ring-accent/30"
            />
          </div>

          {state.error && (
            <p
              role="alert"
              className="rounded-lg border border-accent-red/40 bg-accent-red/10 px-3 py-2 text-[12.5px] text-accent-red"
            >
              {state.error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className="mt-1 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-ink px-3 text-[13px] font-medium text-white shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] transition hover:bg-[#2c2620] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 disabled:opacity-60"
          >
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-center text-[12.5px] text-muted">
          <Link
            href="/"
            className="text-ink-2 underline-offset-2 hover:text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Back to the public label tool
          </Link>
        </p>
      </div>
    </main>
  );
}
