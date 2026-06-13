import type { Queryable } from "@/lib/db/client";
import { getAssignment } from "@/lib/db/repositories/assignments";
import { getBatch } from "@/lib/db/repositories/batches";

/**
 * Central aggregate-level authorization (plan: "Authorization model").
 *
 * Every batch, case, file, export, assignment, and disposition access passes
 * through this module. Reviewer access is scoped to assigned batches (and the
 * cases / files / dispositions under them); admin access is broader but still
 * logged. This is pure decision logic plus small repository reads — no
 * next/react/openai imports — so it runs server-side anywhere.
 */

export type Role = "reviewer" | "admin";

export interface Principal {
  userId: string;
  role: Role;
}

export type AggregateType =
  | "batch"
  | "case"
  | "file"
  | "export"
  | "assignment"
  | "disposition";

export type Action =
  | "read"
  | "write"
  | "dispose"
  | "assign"
  | "replay"
  | "export"
  | "purge";

/** The outcome of an authorization decision. */
export interface AccessDecision {
  allowed: boolean;
  reason: string;
  /** True when the access must be written to the append-only audit log. */
  requiresAudit: boolean;
}

/** Inputs to a single access decision, independent of any I/O. */
export interface DecideAccessParams {
  aggregateType: AggregateType;
  action: Action;
  /** Owner (batch.owner_user_id) or currently-assigned user for the aggregate. */
  ownerOrAssignedUserId?: string | null;
  /** Whether the principal is the user assigned to the governing batch. */
  isAssignedToPrincipal?: boolean;
}

/** Actions only an admin may perform. */
const ADMIN_ONLY_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "assign",
  "replay",
  "purge",
]);

/** Admin actions that must be audited (read is exempt). */
const ADMIN_AUDITED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "write",
  "dispose",
  "assign",
  "replay",
  "purge",
  "export",
]);

/** Reviewer actions that must be audited when allowed. */
const REVIEWER_AUDITED_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "write",
  "dispose",
]);

/**
 * Pure core decision: given a principal and the facts about an aggregate,
 * decide whether the action is allowed, why, and whether it must be audited.
 *
 * Rules:
 *   - admin: allowed for every action. Audited for write/dispose/assign/
 *     replay/purge/export; plain reads need not be audited.
 *   - reviewer: allowed to read/write/dispose only on aggregates governed by a
 *     batch assigned to them (`isAssignedToPrincipal === true`). May `export`
 *     only those assigned aggregates. Never allowed assign/replay/purge — those
 *     are admin-only.
 *   - anything unmatched: deny with a clear reason.
 */
export function decideAccess(
  principal: Principal,
  params: DecideAccessParams
): AccessDecision {
  const { aggregateType, action } = params;
  const assigned = params.isAssignedToPrincipal === true;

  if (principal.role === "admin") {
    return {
      allowed: true,
      reason: `admin broad access (logged): ${action} on ${aggregateType}`,
      requiresAudit: ADMIN_AUDITED_ACTIONS.has(action),
    };
  }

  if (principal.role === "reviewer") {
    if (ADMIN_ONLY_ACTIONS.has(action)) {
      return {
        allowed: false,
        reason: `reviewer may not ${action} ${aggregateType}: admin-only action`,
        requiresAudit: false,
      };
    }

    if (action === "read" || action === "write" || action === "dispose") {
      if (!assigned) {
        return {
          allowed: false,
          reason: `reviewer not assigned to this ${aggregateType}: access scoped to assigned batches`,
          requiresAudit: false,
        };
      }
      return {
        allowed: true,
        reason: `reviewer ${action} on assigned ${aggregateType}`,
        requiresAudit: REVIEWER_AUDITED_ACTIONS.has(action),
      };
    }

    if (action === "export") {
      if (!assigned) {
        return {
          allowed: false,
          reason: `reviewer may export only assigned ${aggregateType}: access scoped to assigned batches`,
          requiresAudit: false,
        };
      }
      return {
        allowed: true,
        reason: `reviewer export of assigned ${aggregateType}`,
        requiresAudit: true,
      };
    }
  }

  return {
    allowed: false,
    reason: `default deny: no rule grants ${principal.role} ${action} on ${aggregateType}`,
    requiresAudit: false,
  };
}

/**
 * Resolve a batch's assignment + owner from the database, then apply
 * {@link decideAccess}. The governing aggregate is the batch itself; cases,
 * files, exports and dispositions inherit their batch's assignment scope, so
 * callers route those through this helper with the owning batch id.
 *
 * `isAssignedToPrincipal` is true when the batch's current assignment belongs to
 * the principal. `ownerOrAssignedUserId` prefers the assigned user, falling back
 * to the batch owner, so audit records can attribute the scoped owner.
 */
export async function authorizeBatchAccess(
  db: Queryable,
  principal: Principal,
  batchId: string,
  action: Action
): Promise<AccessDecision> {
  const [assignment, batch] = await Promise.all([
    getAssignment(db, batchId),
    getBatch(db, batchId),
  ]);

  const isAssignedToPrincipal = assignment?.user_id === principal.userId;
  const ownerOrAssignedUserId =
    assignment?.user_id ?? batch?.owner_user_id ?? null;

  return decideAccess(principal, {
    aggregateType: "batch",
    action,
    ownerOrAssignedUserId,
    isAssignedToPrincipal,
  });
}

/**
 * Raised when an authorization check denies access. Carries the principal role,
 * the aggregate type, the attempted action, and the human-readable reason so the
 * caller (API route) can log the denial and return a 403.
 */
export class ForbiddenError extends Error {
  readonly role: Role;
  readonly aggregateType: AggregateType;
  readonly action: Action;
  readonly reason: string;

  constructor(
    role: Role,
    aggregateType: AggregateType,
    action: Action,
    reason: string
  ) {
    super(`Forbidden: ${role} ${action} on ${aggregateType} — ${reason}`);
    this.name = "ForbiddenError";
    this.role = role;
    this.aggregateType = aggregateType;
    this.action = action;
    this.reason = reason;
  }
}

/**
 * Enforce batch-scoped access: throws {@link ForbiddenError} when the action is
 * denied, otherwise returns whether the granted access must be audited. Call
 * this at the start of any batch/case/file/export/disposition handler.
 */
export async function assertBatchAccess(
  db: Queryable,
  principal: Principal,
  batchId: string,
  action: Action
): Promise<{ requiresAudit: boolean }> {
  const decision = await authorizeBatchAccess(db, principal, batchId, action);
  if (!decision.allowed) {
    throw new ForbiddenError(principal.role, "batch", action, decision.reason);
  }
  return { requiresAudit: decision.requiresAudit };
}
