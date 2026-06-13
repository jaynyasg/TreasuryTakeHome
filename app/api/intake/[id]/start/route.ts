import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createPgPool } from "@/lib/db/pg";
import { createPostgresOutboxQueue } from "@/lib/adapters/queue/postgresOutbox";
import {
  startBatch,
  IntakeSessionNotFoundError,
} from "@/lib/db/services/startBatch";
import { durableBatchEnabled, principalFromSession } from "../../_session";

export const maxDuration = 60;

/**
 * Start the durable batch for an intake session (plan T4; "Idempotent intake":
 * "a single allowed transition into processing"). Reviewer/admin only, gated
 * behind `DURABLE_BATCH=1`.
 *
 * Delegates straight to the `startBatch` service-command, which is itself
 * idempotent: re-POSTing (refresh/retry/double-submit) returns the SAME batch
 * and enqueues no duplicate jobs. The queue is the Postgres outbox (the named
 * fallback provider), built from the same pool so enqueue + DB writes share one
 * Postgres.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  if (!durableBatchEnabled()) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const principal = principalFromSession(await auth());
  if (!principal) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401 }
    );
  }

  const { id: sessionId } = await params;
  const db = createPgPool();
  try {
    const queue = createPostgresOutboxQueue(db);
    const result = await startBatch(db, queue, {
      intakeSessionId: sessionId,
      ownerUserId: principal.userId,
    });
    return NextResponse.json({
      ok: true,
      batchId: result.batchId,
      caseCount: result.caseCount,
    });
  } catch (err) {
    if (err instanceof IntakeSessionNotFoundError) {
      return NextResponse.json(
        { ok: false, error: "Intake session not found." },
        { status: 404 }
      );
    }
    throw err;
  } finally {
    await db.close();
  }
}
