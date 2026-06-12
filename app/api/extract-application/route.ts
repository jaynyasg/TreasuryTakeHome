import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, ApplicationExtractResponse } from "@/lib/contract";
import {
  ApplicationExtractionError,
  extractApplicationFromFiles,
} from "@/lib/applicationExtract";
import { isSupportedLabelDataUrl, MAX_LABEL_FILES } from "@/lib/labelFiles";

export const maxDuration = 30;

const ExtractApplicationRequest = z.object({
  fileDataUrls: z
    .array(z.string().refine(isSupportedLabelDataUrl, "Expected an image or PDF data URL."))
    .min(1)
    .max(MAX_LABEL_FILES),
});

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return error(400, "Request body must be JSON.");
  }

  const parsed = ExtractApplicationRequest.safeParse(body);
  if (!parsed.success) {
    return error(400, `Invalid request: ${parsed.error.issues[0]?.message ?? "schema mismatch"}`);
  }

  try {
    const { application, usage } = await extractApplicationFromFiles(parsed.data.fileDataUrls);
    const response: ApplicationExtractResponse = { ok: true, application, usage };
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof ApplicationExtractionError) {
      return error(500, `Application extraction failed: ${err.message}`, err.retryable);
    }
    return error(500, err instanceof Error ? err.message : "Unexpected error");
  }
}

function error(status: number, message: string, retryable = false): NextResponse {
  const body: ApiError = { ok: false, error: message, retryable };
  return NextResponse.json(body, { status });
}
