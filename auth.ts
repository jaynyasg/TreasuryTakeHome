/**
 * Node-runtime Auth.js entrypoint (NextAuth v5, App Router split-config pattern).
 *
 * Composes the edge-safe `authConfig` (route gating + pages) with the
 * Credentials provider, whose `authorize` hits Postgres and verifies a scrypt
 * hash — both Node-only, so they live here and NOT in `auth.config.ts`.
 *
 * Session strategy is JWT (no DB session table; the Credentials provider
 * requires JWT sessions). The `jwt` callback stamps role + userId into the
 * token on sign-in; the `session` callback exposes them to the app.
 *
 * Exports `{ handlers, auth, signIn, signOut }` for the route handler and
 * server-side session access.
 */
import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { authConfig } from "@/auth.config";
import { createPgPool } from "@/lib/db/pg";
import { getUserByEmail } from "@/lib/db/repositories/users";
import { verifyPassword } from "@/lib/auth/password";

// Role/userId augmentation of User/Session/JWT lives in types/next-auth.d.ts.

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: { strategy: "jwt" },
  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string" ? credentials.email : null;
        const password =
          typeof credentials?.password === "string"
            ? credentials.password
            : null;
        if (!email || !password) return null;

        const db = createPgPool();
        try {
          const user = await getUserByEmail(db, email);
          if (!user?.password_hash) return null;

          const ok = await verifyPassword(password, user.password_hash);
          if (!ok) return null;

          return {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
          };
        } finally {
          await db.close();
        }
      },
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    jwt({ token, user }) {
      // `user` is only present on initial sign-in; persist identity into the JWT.
      if (user) {
        token.role = user.role;
        token.userId = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.role = token.role;
        session.user.userId = token.userId;
      }
      return session;
    },
  },
});
