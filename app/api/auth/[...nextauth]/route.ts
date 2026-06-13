/**
 * Auth.js v5 catch-all route handler. Exposes the NextAuth REST endpoints
 * (sign-in, sign-out, session, csrf, callback) under /api/auth/*.
 */
import { handlers } from "@/auth";

export const { GET, POST } = handlers;
