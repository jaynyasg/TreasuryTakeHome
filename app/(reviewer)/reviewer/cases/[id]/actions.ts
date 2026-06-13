"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requirePrincipal } from "@/lib/server/session";
import { createPgPool } from "@/lib/db/pg";
import { getCase } from "@/lib/db/repositories/cases";
import { authorizeBatchAccess } from "@/lib/auth/authorize";
import {
  recordDisposition,
  MissingReasonError,
} from "@/lib/db/services/recordDisposition";
import type { DispositionAction } from "@/lib/db/repositories/dispositions";
import type {
  DispositionInput,
  DispositionResult,
} from "@/components/case/types";

/**
 * Server action backing the Case Detail disposition controls (Stage 7 / T7,
 * Wave 2 — plan "Disposition Interaction Rules"). It is the AUTHORITATIVE human
 * write path; the machine verdict is only advisory.
 *
 * Flow (all server-side, never trusting the client):
 *   1. resolve the principal (redirects to /login when absent),
 *   2. re-check batch-scoped authorization for the `dispose` action — the page
 *      render-time check is not enough; the action re-authorizes at write time,
 *   3. delegate to `recordDisposition`, which enforces the reason rules
 *      (`MissingReasonError`), the case state transition, and the append-only
 *      audit event ATOMICALLY in one transaction,
 *   4. revalidate the case page so the recorded disposition + actor + timestamp
 *      + reason render in the header and timeline.
 *
 * Returns a typed result the client renders inline — it never throws to the
 * client for the expected failure modes (missing reason, forbidden, stale).
 */

const VALID_ACTIONS: ReadonlySet<DispositionAction> = new Set([
  "approve",
  "reject",
  "request_better_image",
]);

export async function recordDispositionAction(
  input: DispositionInput
): Promise<DispositionResult> {
  if (!VALID_ACTIONS.has(input.action)) {
    return { ok: false, error: "Unknown disposition action." };
  }

  const principal = await requirePrincipal();
  const db = createPgPool();
  try {
    // Resolve case -> batch so authorization scopes to the governing batch.
    const caseRow = await getCase(db, input.caseId);
    if (!caseRow) {
      return { ok: false, error: "This case no longer exists." };
    }

    const decision = await authorizeBatchAccess(
      db,
      principal,
      caseRow.batch_id,
      "dispose"
    );
    if (!decision.allowed) {
      return {
        ok: false,
        error: "You are not authorized to disposition this case.",
      };
    }

    // Compose the audited reason. Better-image requests fold the category and
    // affected files into the reason so the audit summary is self-contained.
    const reason = composeReason(input);

    try {
      const result = await recordDisposition(db, {
        dispositionId: randomUUID(),
        auditEventId: randomUUID(),
        caseId: input.caseId,
        actorUserId: principal.userId,
        action: input.action,
        reason,
      });

      revalidatePath(`/reviewer/cases/${input.caseId}`);

      return {
        ok: true,
        recorded: {
          action: result.disposition.action,
          actorUserId: result.disposition.actor_user_id,
          at: result.disposition.created_at,
          reason: result.disposition.reason,
        },
      };
    } catch (err) {
      if (err instanceof MissingReasonError) {
        return {
          ok: false,
          error: `A reason is required to ${humanAction(err.action)}.`,
        };
      }
      // An illegal state transition (already dispositioned, or a concurrent
      // change) bubbles up from setCaseStatus as a generic Error — surface a
      // stale-state message rather than leaking internals.
      return {
        ok: false,
        error:
          "This case could not be dispositioned — it may have already changed. Refresh and try again.",
      };
    }
  } finally {
    await db.close();
  }
}

/** Fold category + affected files into the persisted reason for better-image
 *  requests; pass the plain note through otherwise. */
function composeReason(input: DispositionInput): string | null {
  if (input.action === "request_better_image") {
    const parts: string[] = [];
    if (input.category?.trim()) parts.push(`Category: ${input.category.trim()}`);
    if (input.reason?.trim()) parts.push(input.reason.trim());
    if (input.affectedFileIds && input.affectedFileIds.length > 0) {
      parts.push(`Affected files: ${input.affectedFileIds.join(", ")}`);
    }
    return parts.length > 0 ? parts.join(" — ") : null;
  }
  return input.reason?.trim() ? input.reason.trim() : null;
}

function humanAction(action: DispositionAction): string {
  if (action === "reject") return "reject this case";
  if (action === "request_better_image") return "request a better image";
  return "approve this case";
}
