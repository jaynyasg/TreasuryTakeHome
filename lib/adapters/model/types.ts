import type { ExtractedLabel } from "@/lib/contract";

/**
 * The MODEL adapter seam (production-gap-closure Stage 4 / "Malformed AI output").
 *
 * The worker built next owns model calls. The adapter narrows the model
 * boundary to a single operation — extract label fields from one label image —
 * and returns a discriminated union instead of throwing. This lets the worker
 * route outcomes per the plan:
 *   - ok:true              -> contract-valid extraction, proceed to scoring
 *   - error:"malformed"    -> schema-invalid / non-JSON output -> needs-review/failed
 *   - error:"refusal"      -> model refused -> failed (not retryable)
 *   - error:"empty"        -> empty content / no choices / truncation -> needs-review/failed
 *   - error:"timeout"      -> transient upstream failure -> bounded retry
 *
 * All model output that claims success is parsed through the zod contract
 * (`ExtractedLabel`) before it can become {ok:true}. Nothing unvalidated
 * flows inward.
 */

/** Re-export so callers can reference the adapter's data shape without reaching into the contract. */
export type { ExtractedLabel };

export interface LabelExtractionInput {
  /** Base64-encoded label image bytes (no data: URL prefix). */
  imageBase64: string;
  /** MIME type of the image, e.g. "image/png", "image/jpeg", "application/pdf". */
  mimeType: string;
}

/** Why an extraction did not yield a contract-valid label. */
export type ModelExtractionError = "malformed" | "refusal" | "empty" | "timeout";

/**
 * Outcome of a single label extraction. A discriminated union so the worker
 * routes malformed/refusal/empty to needs-review/failed and timeout to retry,
 * rather than catching thrown errors.
 */
export type ModelExtractionResult =
  | { ok: true; data: ExtractedLabel }
  | { ok: false; error: ModelExtractionError; raw?: string };

export interface ModelAdapter {
  extractLabel(input: LabelExtractionInput): Promise<ModelExtractionResult>;
}
