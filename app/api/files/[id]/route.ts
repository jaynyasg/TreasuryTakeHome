import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import type { Session } from "next-auth";
import { auth } from "@/auth";
import { createPgPool } from "@/lib/db/pg";
import {
  authorizeBatchAccess,
  ForbiddenError,
  type Principal,
  type Role,
} from "@/lib/auth/authorize";
import { getCaseFile } from "@/lib/db/repositories/caseFiles";
import { getCase } from "@/lib/db/repositories/cases";
import { appendAuditEvent } from "@/lib/db/repositories/auditEvents";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import { createVercelBlobStorage } from "@/lib/adapters/storage/vercelBlob";
import type { StorageAdapter } from "@/lib/adapters/storage/types";

export const maxDuration = 30;

/** Short-lived signed-URL TTL when the provider can mint one (else proxy). */
const SIGNED_URL_TTL_SECONDS = 60;

/**
 * Authorized file access (plan "File access security" + "Authorization model";
 * preflight §2 Storage). Reviewer/admin access to a source file, evidence crop,
 * or export artifact passes through central batch-scoped authorization, is
 * audited, and is served either via a short-lived signed URL (302) or — when the
 * provider can't mint one — the app-mediated proxy: this route streams the bytes
 * itself after authorizing and auditing. Signed URLs are never persisted.
 *
 * Gated behind `DURABLE_BATCH=1`: 404 when the durable batch path is off, so the
 * route is dark until the feature flag is enabled (plan "Rollout posture").
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  if (process.env.DURABLE_BATCH !== "1") {
    return NextResponse.json(
      { ok: false, error: "Not found." },
      { status: 404 }
    );
  }

  const session = await auth();
  const principal = principalFromSession(session);
  if (!principal) {
    return NextResponse.json(
      { ok: false, error: "Authentication required." },
      { status: 401 }
    );
  }

  const { id } = await params;
  const db = createPgPool();
  try {
    // Resolve file -> case -> batch so authorization scopes to the governing batch.
    const file = await getCaseFile(db, id);
    if (!file || !file.object_key) {
      return NextResponse.json(
        { ok: false, error: "File not found." },
        { status: 404 }
      );
    }
    const caseRow = await getCase(db, file.case_id);
    if (!caseRow) {
      return NextResponse.json(
        { ok: false, error: "File not found." },
        { status: 404 }
      );
    }

    try {
      const decision = await authorizeBatchAccess(
        db,
        principal,
        caseRow.batch_id,
        "read"
      );
      if (!decision.allowed) {
        throw new ForbiddenError(principal.role, "file", "read", decision.reason);
      }
    } catch (err) {
      if (err instanceof ForbiddenError) {
        return NextResponse.json(
          { ok: false, error: "Forbidden." },
          { status: 403 }
        );
      }
      throw err;
    }

    // Access granted: append the append-only audit event for this read.
    await appendAuditEvent(db, {
      id: randomUUID(),
      actorUserId: principal.userId,
      action: "file.read",
      aggregateType: "file",
      aggregateId: file.id,
      reason: null,
      traceId: req.headers.get("x-request-id"),
      sourceIp:
        req.headers.get("x-forwarded-for") ?? req.headers.get("x-real-ip"),
      userAgent: req.headers.get("user-agent"),
    });

    const storage = selectStorage();

    // Prefer a short-lived scoped signed URL; redirect the client to it.
    const signedUrl = await storage.getSignedUrl(
      file.object_key,
      SIGNED_URL_TTL_SECONDS
    );
    if (signedUrl) {
      return NextResponse.redirect(signedUrl, 302);
    }

    // Provider can't sign: app-mediated proxy — stream the bytes ourselves.
    const object = await storage.get(file.object_key);
    if (!object) {
      return NextResponse.json(
        { ok: false, error: "Object missing from storage." },
        { status: 404 }
      );
    }
    const contentType =
      file.content_type ?? object.contentType ?? "application/octet-stream";
    return new Response(toBodyInit(object.data), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(object.data.byteLength),
        "Cache-Control": "private, no-store",
      },
    });
  } finally {
    await db.close();
  }
}

/** Build a {@link Principal} from the Auth.js session, or null when unusable. */
function principalFromSession(session: Session | null): Principal | null {
  const userId = session?.user?.userId;
  const role = session?.user?.role;
  if (!userId || !isRole(role)) return null;
  return { userId, role };
}

function isRole(value: unknown): value is Role {
  return value === "reviewer" || value === "admin";
}

/** Select the storage adapter for the active provider (preflight §3 env). */
function selectStorage(): StorageAdapter {
  return process.env.STORAGE_PROVIDER === "vercel-blob"
    ? createVercelBlobStorage()
    : createFakeStorage();
}

/** Detach a view into a standalone ArrayBuffer so the body is a valid BodyInit. */
function toBodyInit(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}
