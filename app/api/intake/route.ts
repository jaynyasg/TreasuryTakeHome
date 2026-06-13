import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { createPgPool } from "@/lib/db/pg";
import { createIntakeSession } from "@/lib/db/repositories/intake";
import { durableBatchEnabled, principalFromSession } from "./_session";

export const maxDuration = 30;

/**
 * Create (or idempotently resume) an intake session (plan T4; "Idempotent
 * intake"). Reviewer/admin only, gated behind `DURABLE_BATCH=1` so the route is
 * dark until the durable batch path is enabled (plan "Rollout posture").
 *
 * The body's `idempotencyKey` is what makes a refresh/retry/double-submit safe:
 * `createIntakeSession` returns the EXISTING session for a repeated key rather
 * than minting a second one. Logic lives in the repository; this route is a thin
 * auth + parse + delegate seam.
 */
const CreateIntakeRequest = z.object({
  idempotencyKey: z.string().min(1),
  manifestHash: z.string().min(1).optional(),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be JSON." },
      { status: 400 }
    );
  }

  const parsed = CreateIntakeRequest.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        ok: false,
        error: `Invalid request: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`,
      },
      { status: 400 }
    );
  }

  const db = createPgPool();
  try {
    const session = await createIntakeSession(db, {
      id: randomUUID(),
      idempotencyKey: parsed.data.idempotencyKey,
      manifestHash: parsed.data.manifestHash ?? null,
    });
    return NextResponse.json({
      ok: true,
      session: { id: session.id, status: session.status },
    });
  } finally {
    await db.close();
  }
}
