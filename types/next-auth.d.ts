/**
 * Module augmentation: carry `role` + `userId` through Auth.js's User, Session,
 * and JWT types so `auth().user.role` and the jwt/session callbacks are typed.
 *
 * The leading imports force TS to resolve these modules before augmenting them
 * (required under `moduleResolution: bundler`).
 */
import "next-auth";
import "next-auth/jwt";
import type { DefaultSession } from "next-auth";
import type { UserRole } from "@/lib/db/repositories/users";

declare module "next-auth" {
  interface User {
    role?: UserRole;
  }
  interface Session {
    user?: {
      role?: UserRole;
      userId?: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    userId?: string;
  }
}
