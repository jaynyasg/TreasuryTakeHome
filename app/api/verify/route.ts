import { NextRequest, NextResponse } from "next/server";
import { ColaApplication, VerifyResponse, ApiError } from "@/lib/contract";
import { extractLabel, ExtractionError } from "@/lib/extract";
import { buildMatchReport } from "@/lib/engine/score";
import { z } from "zod";

export const maxDuration = 30;

const VerifyRequest = z.object({
  application: ColaApplication,
  /** data: URLs of the label set images (front/back/neck of one container). */
  imageDataUrls: z.array(z.string().startsWith("data:image/")).min(1).max(4),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(400, "Request body must be JSON.");
  }
  const parsed = VerifyRequest.safeParse(body);
  if (!parsed.success) {
    return error(400, `Invalid request: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  }

  try {
    const extracted = await extractLabel(parsed.data.imageDataUrls);
    const report = buildMatchReport(parsed.data.application, extracted);
    const response: VerifyResponse = {
      ok: true,
      extracted,
      report,
      elapsedMs: Date.now() - started,
    };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof ExtractionError) {
      return error(502, `Label extraction failed: ${err.message}`);
    }
    return error(500, err instanceof Error ? err.message : "Unexpected error");
  }
}

function error(status: number, message: string): NextResponse {
  const body: ApiError = { ok: false, error: message };
  return NextResponse.json(body, { status });
}
