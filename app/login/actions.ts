"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { AuthError } from "next-auth";
import { signIn } from "@/auth";

/**
 * Server action backing the login form (`app/login/page.tsx`).
 *
 * Calls the Auth.js Credentials provider. On success `signIn` throws a redirect
 * (to `/reviewer`, which then role-routes) — we re-throw redirect errors so Next
 * performs the navigation. On bad credentials Auth.js throws an `AuthError`
 * (typically `CredentialsSignin`); we map that to a plain message the form shows.
 * Any other error becomes a generic message so we never leak internals.
 */
export interface LoginState {
  error?: string;
}

export async function loginAction(
  _prev: LoginState,
  formData: FormData
): Promise<LoginState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter both your email and password." };
  }

  try {
    await signIn("credentials", {
      email,
      password,
      redirectTo: "/reviewer",
    });
    // Unreachable on success: signIn throws a redirect handled below.
    return {};
  } catch (error) {
    // A redirect is the SUCCESS path for signIn — let Next handle it.
    if (isRedirectError(error)) {
      throw error;
    }
    if (error instanceof AuthError) {
      return { error: "Incorrect email or password. Please try again." };
    }
    return { error: "Could not sign you in right now. Please try again." };
  }
}
