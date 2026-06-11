import { NextRequest, NextResponse } from "next/server";
import {
  ApiError,
  ColaApplication,
  StageEvent,
  VerifyResponse,
} from "@/lib/contract";
import { extractLabel, ExtractionError } from "@/lib/extract";
import { buildMatchReport } from "@/lib/engine/score";
import { isSupportedLabelDataUrl, MAX_LABEL_FILES } from "@/lib/labelFiles";
import { z } from "zod";

export const maxDuration = 30;

const VerifyRequest = z.object({
  application: ColaApplication,
  /** data: URLs of the label set files (front/back/neck images or PDFs of one container). */
  imageDataUrls: z
    .array(z.string().refine(isSupportedLabelDataUrl, "Expected an image or PDF data URL."))
    .min(1)
    .max(MAX_LABEL_FILES),
});

/**
 * Streams NDJSON: zero or more StageEvent lines ("extracting", "matching")
 * emitted when each phase actually starts, then exactly one terminal line —
 * a VerifyResponse on success or an ApiError on failure. Request-shape
 * errors are rejected up front as plain JSON 400s before any stream starts.
 */
export async function POST(req: NextRequest): Promise<Response> {
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

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: StageEvent | VerifyResponse | ApiError) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      try {
        send({ stage: "extracting" });
        const { label: extracted, usage } = await extractLabel(parsed.data.imageDataUrls);
        send({ stage: "matching" });
        const report = buildMatchReport(parsed.data.application, extracted);
        send({ ok: true, extracted, report, elapsedMs: Date.now() - started, usage });
      } catch (err) {
        if (err instanceof ExtractionError) {
          send({
            ok: false,
            error: `Label extraction failed: ${err.message}`,
            retryable: err.retryable,
          });
        } else {
          send({
            ok: false,
            error: err instanceof Error ? err.message : "Unexpected error",
            retryable: false,
          });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}

function error(status: number, message: string): NextResponse {
  const body: ApiError = { ok: false, error: message };
  return NextResponse.json(body, { status });
}
