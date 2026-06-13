import type { Session } from "next-auth";
import type { Principal, Role } from "@/lib/auth/authorize";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import { createVercelBlobStorage } from "@/lib/adapters/storage/vercelBlob";

/**
 * Shared seams for the intake API routes (plan T4). Keeps each route thin: the
 * tested logic lives in `lib/intake` + `lib/db/services`, while these helpers
 * cover the cross-cutting auth/flag/provider plumbing every intake route shares.
 */

/** True when the durable batch path is enabled (plan "Rollout posture"). */
export function durableBatchEnabled(): boolean {
  return process.env.DURABLE_BATCH === "1";
}

/** Build a reviewer/admin {@link Principal} from the session, or null. */
export function principalFromSession(session: Session | null): Principal | null {
  const userId = session?.user?.userId;
  const role = session?.user?.role;
  if (!userId || !isRole(role)) return null;
  return { userId, role };
}

function isRole(value: unknown): value is Role {
  return value === "reviewer" || value === "admin";
}

/** Select the storage adapter for the active provider (preflight §3 env). */
export function selectStorage(): StorageAdapter {
  return process.env.STORAGE_PROVIDER === "vercel-blob"
    ? createVercelBlobStorage()
    : createFakeStorage();
}
