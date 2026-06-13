import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { createPgPool } from "@/lib/db/pg";
import {
  getIntakeSession,
  listManifestEntries,
  type ManifestEntryRow,
} from "@/lib/db/repositories/intake";
import { computePreflight } from "@/lib/intake/preflight";
import type { ManifestEntry } from "@/lib/intake/types";
import { durableBatchEnabled, principalFromSession } from "../../_session";

export const maxDuration = 30;

/** Demo-scale preflight cost/throughput constants (tune from real measurement). */
const PREFLIGHT_OPTS = {
  perCaseCostUsd: 0.02,
  perCaseSeconds: 30,
  concurrency: 5,
};

/**
 * Preflight summary for an intake session (plan T4; journey step 2: catch
 * missing pairs/duplicates/unsupported and show estimated cost/time before
 * processing). Reviewer/admin only, gated behind `DURABLE_BATCH=1`.
 *
 * Loads the session's manifest rows and folds them through the pure
 * `computePreflight`; the route just maps rows → domain shape and returns the
 * summary.
 */
export async function GET(
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
    const session = await getIntakeSession(db, sessionId);
    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Intake session not found." },
        { status: 404 }
      );
    }

    const rows = await listManifestEntries(db, sessionId);
    const summary = computePreflight(rows.map(rowToManifestEntry), PREFLIGHT_OPTS);
    return NextResponse.json({ ok: true, summary });
  } finally {
    await db.close();
  }
}

/** Map a stored manifest_entries row to the domain ManifestEntry shape. */
function rowToManifestEntry(row: ManifestEntryRow): ManifestEntry {
  return {
    fileName: row.file_name,
    kind: row.kind,
    caseKey: row.case_key,
    checksum: row.checksum ?? "",
    size: row.size_bytes ?? 0,
    contentType: row.content_type ?? "",
    status: row.status,
  };
}
