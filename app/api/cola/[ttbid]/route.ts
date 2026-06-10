import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { ApiError, ColaPrefillResponse } from "@/lib/contract";
import { ColaParseError, isValidTtbId, parseColaHtml } from "@/lib/cola";

export const maxDuration = 15;

const REGISTRY_URL =
  "https://ttbonline.gov/colasonline/viewColaDetails.do?action=publicFormDisplay&ttbid=";
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 512 * 1024; // hardening 3A: cap untrusted response size

/**
 * Read-only lookup of a public COLA registry page (see plan AC-2: reference
 * data, not COLA-system integration). Live fetch first; on any failure, fall
 * back to a committed HTML fixture when one exists for this TTB ID — the
 * response is labeled "live" vs "cached" so the UI never passes off canned
 * data as a live fetch.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ttbid: string }> }
): Promise<NextResponse> {
  const { ttbid } = await params;
  if (!isValidTtbId(ttbid)) {
    return error(400, "TTB ID must be exactly 14 digits.");
  }

  const live = await fetchLive(ttbid);
  if (live) {
    try {
      const { application } = parseColaHtml(live);
      return ok({ ok: true, ttbid, source: "live", application });
    } catch {
      // fall through to fixture
    }
  }

  const fixture = readFixture(ttbid);
  if (fixture) {
    try {
      const { application } = parseColaHtml(fixture);
      return ok({ ok: true, ttbid, source: "cached", application });
    } catch {
      // fixture unparseable — treat as not found
    }
  }

  return error(
    502,
    "Could not reach the COLA registry (or no COLA found for that ID). Enter the application manually."
  );
}

async function fetchLive(ttbid: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${REGISTRY_URL}${ttbid}`, {
      signal: controller.signal,
      headers: { "User-Agent": "label-verify-prototype/1.0 (reference lookup)" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) return null;
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function readFixture(ttbid: string): string | null {
  try {
    const p = path.join(process.cwd(), "eval", "fixtures", `cola-${ttbid}.html`);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}

function ok(body: ColaPrefillResponse): NextResponse {
  return NextResponse.json(body);
}

function error(status: number, message: string): NextResponse {
  const body: ApiError = { ok: false, error: message };
  return NextResponse.json(body, { status });
}
