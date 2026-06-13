import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { auth } from "@/auth";
import { createPgPool } from "@/lib/db/pg";
import {
  addManifestEntry,
  getIntakeSession,
  listManifestEntries,
} from "@/lib/db/repositories/intake";
import {
  classifyFile,
  type ManifestMap,
} from "@/lib/intake/pairing";
import { durableBatchEnabled, principalFromSession, selectStorage } from "../../_session";

export const maxDuration = 30;

/**
 * Accept one uploaded file into an intake session's manifest (plan T4;
 * "Resumable uploads"). Reviewer/admin only, gated behind `DURABLE_BATCH=1`.
 *
 * Resumability is by checksum: the bytes are hashed BEFORE storage, and if any
 * existing manifest entry already has that checksum, the file is recorded as a
 * `duplicate` and NOT re-stored (the resume path — re-uploading the same file is
 * cheap and side-effect-free). Otherwise the bytes are stored under
 * `intake/{sessionId}/{fileName}` and a fresh manifest entry is added.
 *
 * Two body shapes are accepted: multipart/form-data (`file` field, optional
 * `manifest` JSON), or a base64 JSON body. Classification + dedupe are the
 * tested domain logic in `lib/intake`; this route is a thin storage + persist
 * seam.
 */
const Base64Body = z.object({
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  /** Raw base64 (no data: prefix) of the file bytes. */
  dataBase64: z.string().min(1),
  /** Optional explicit pairing override. */
  manifest: z
    .record(z.string(), z.object({ application: z.string(), label: z.string() }))
    .optional(),
});

interface UploadedFile {
  fileName: string;
  contentType: string;
  bytes: Uint8Array;
  manifest?: ManifestMap;
}

export async function POST(
  req: NextRequest,
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

  let upload: UploadedFile | null;
  try {
    upload = await parseUpload(req);
  } catch {
    upload = null;
  }
  if (!upload) {
    return NextResponse.json(
      { ok: false, error: "Expected a multipart file or base64 JSON body." },
      { status: 400 }
    );
  }

  const db = createPgPool();
  try {
    const session = await getIntakeSession(db, sessionId);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Intake session not found." },
        { status: 404 }
      );
    }

    const checksum = sha256Hex(upload.bytes);

    // Resumable dedupe: same checksum already in this session's manifest =>
    // record a duplicate, skip re-storing the bytes.
    const existing = await listManifestEntries(db, sessionId);
    const isDuplicate = existing.some((e) => e.checksum === checksum);

    const classified = classifyFile(
      {
        fileName: upload.fileName,
        contentType: upload.contentType,
        checksum,
        size: upload.bytes.byteLength,
      },
      upload.manifest
    );

    // Unsupported => invalid (rejected, not stored). Duplicate => skip store.
    const status =
      classified.status === "invalid"
        ? "invalid"
        : isDuplicate
        ? "duplicate"
        : "uploaded";

    let objectKey: string | null = null;
    if (status === "uploaded") {
      objectKey = `intake/${sessionId}/${upload.fileName}`;
      const storage = selectStorage();
      await storage.put(objectKey, upload.bytes, {
        contentType: upload.contentType,
      });
    }

    const entry = await addManifestEntry(db, {
      id: randomUUID(),
      intakeSessionId: sessionId,
      fileName: classified.fileName,
      kind: classified.kind,
      caseKey: classified.caseKey,
      checksum,
      sizeBytes: upload.bytes.byteLength,
      contentType: upload.contentType,
      status,
      objectKey,
    });

    const manifest = await listManifestEntries(db, sessionId);
    return NextResponse.json({ ok: true, entry, manifest });
  } finally {
    await db.close();
  }
}

/** Parse either a multipart upload or a base64 JSON body into raw bytes. */
async function parseUpload(req: NextRequest): Promise<UploadedFile | null> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const manifestRaw = form.get("manifest");
    const manifest =
      typeof manifestRaw === "string" ? parseManifest(manifestRaw) : undefined;
    return {
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      bytes,
      manifest,
    };
  }

  const parsed = Base64Body.safeParse(await req.json());
  if (!parsed.success) return null;
  return {
    fileName: parsed.data.fileName,
    contentType: parsed.data.contentType,
    bytes: new Uint8Array(Buffer.from(parsed.data.dataBase64, "base64")),
    manifest: parsed.data.manifest,
  };
}

/** Parse a JSON manifest-map string, returning undefined on malformed input. */
function parseManifest(raw: string): ManifestMap | undefined {
  try {
    const obj: unknown = JSON.parse(raw);
    const schema = z.record(
      z.string(),
      z.object({ application: z.string(), label: z.string() })
    );
    const result = schema.safeParse(obj);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
