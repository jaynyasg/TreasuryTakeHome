import type { ColaApplication, ExtractedLabel } from "@/lib/contract";

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

/** Re-export so callers can reference the adapter's data shapes without reaching into the contract. */
export type { ExtractedLabel, ColaApplication };

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

/**
 * Input for extracting application fields from one uploaded COLA application
 * file (a PDF or an image). The bytes are base64-encoded with NO data: URL
 * prefix; the adapter builds the data URL its underlying client needs.
 */
export interface ApplicationExtractionInput {
  /** Base64-encoded application file bytes (no data: URL prefix). */
  fileBase64: string;
  /** MIME type of the file, e.g. "application/pdf", "image/png", "image/jpeg". */
  mimeType: string;
}

/**
 * Outcome of one application extraction. Same discriminated-union shape as
 * {@link ModelExtractionResult} so the worker routes identically:
 *   - ok:true            -> contract-valid ColaApplication, proceed to scoring
 *   - error:"timeout"    -> transient upstream failure -> bounded retry
 *   - error:"malformed"  -> schema-invalid / non-JSON output -> fail (no retry)
 *   - error:"refusal"    -> model refused -> fail (not retryable)
 *   - error:"empty"      -> empty content / no choices / truncation -> fail
 *
 * As with the label path, any success is parsed through the `ColaApplication`
 * zod contract before it can become {ok:true}; nothing unvalidated flows inward.
 */
export type ApplicationExtractionResult =
  | { ok: true; data: ColaApplication }
  | { ok: false; error: ModelExtractionError; raw?: string };

export interface ModelAdapter {
  extractLabel(input: LabelExtractionInput): Promise<ModelExtractionResult>;
  /**
   * Extract the matchable COLA application fields from one uploaded application
   * file. Used by the worker's on-demand path when a durable batch started from
   * real uploads has no pre-persisted `application.*` fields. Routing mirrors
   * `extractLabel`: timeout -> retry; malformed/refusal/empty -> fail.
   */
  extractApplication(
    input: ApplicationExtractionInput
  ): Promise<ApplicationExtractionResult>;
}
