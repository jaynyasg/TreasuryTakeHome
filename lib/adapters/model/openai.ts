import { extractLabel as extractLabelViaOpenAI, ExtractionError } from "@/lib/extract";
import type {
  LabelExtractionInput,
  ModelAdapter,
  ModelExtractionError,
  ModelExtractionResult,
} from "@/lib/adapters/model/types";

/**
 * Production MODEL adapter: wraps the existing OpenAI extraction logic in
 * `lib/extract.ts` and maps its outcomes into the adapter's discriminated
 * union so the worker can route them (instead of catching thrown errors).
 *
 * Lazy by construction: importing this module constructs nothing. The OpenAI
 * client is built lazily inside `lib/extract.ts` (getClient) and is only
 * touched when extractLabel actually runs, so importing the adapter needs no
 * OPENAI_API_KEY. (Typecheck-only — never exercised in the test suite.)
 */

function dataUrl(input: LabelExtractionInput): string {
  return `data:${input.mimeType};base64,${input.imageBase64}`;
}

/**
 * Classify an ExtractionError from lib/extract.ts into a ModelExtractionError.
 *
 * lib/extract.ts throws with stable message prefixes:
 *   - "Model refused: ..."                  -> refusal
 *   - "Model returned empty content"        -> empty
 *   - "Model returned no choices"           -> empty
 *   - "Model output was truncated"          -> empty (length cutoff: incomplete output)
 *   - "Model output was not valid JSON"     -> malformed
 *   - "...violated the contract..."         -> malformed
 *   - transient upstream (retryable flag)   -> timeout
 *
 * Retryable upstream failures (429/5xx/network) are surfaced as "timeout" so
 * the worker applies bounded retries; everything else is terminal.
 */
function classify(err: ExtractionError): ModelExtractionError {
  if (err.retryable) return "timeout";
  const message = err.message;
  if (message.startsWith("Model refused")) return "refusal";
  if (
    message === "Model returned empty content" ||
    message === "Model returned no choices" ||
    message === "Model output was truncated"
  ) {
    return "empty";
  }
  if (message === "Model output was not valid JSON" || message.includes("violated the contract")) {
    return "malformed";
  }
  // Unknown hard failure: treat as malformed so it routes to needs-review/failed,
  // never to a misleading success.
  return "malformed";
}

export function createOpenAIModel(): ModelAdapter {
  return {
    async extractLabel(input: LabelExtractionInput): Promise<ModelExtractionResult> {
      try {
        const { label } = await extractLabelViaOpenAI(dataUrl(input));
        return { ok: true, data: label };
      } catch (err) {
        if (err instanceof ExtractionError) {
          return { ok: false, error: classify(err), raw: err.message };
        }
        // Non-ExtractionError (unexpected): surface as malformed with safe raw capture.
        return {
          ok: false,
          error: "malformed",
          raw: err instanceof Error ? err.message : "Unknown extraction failure",
        };
      }
    },
  };
}
