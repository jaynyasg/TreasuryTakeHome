import { z } from "zod";

/**
 * The single typed contract at every seam: LLM output, API routes, client.
 * All external payloads are parsed against these schemas at the boundary —
 * nothing downstream handles unvalidated shapes.
 */

export const BeverageType = z.enum(["wine", "distilled_spirits", "malt_beverage"]);
export type BeverageType = z.infer<typeof BeverageType>;

/** Fields of TTB Form 5100.31 that participate in label matching. */
export const ColaApplication = z.object({
  serialNumber: z.string(),
  beverageType: BeverageType,
  sourceOfProduct: z.enum(["domestic", "imported"]),
  brandName: z.string().min(1),
  fancifulName: z.string().optional(),
  classType: z.string().min(1),
  /** As written on the form, e.g. "45% Alc./Vol. (90 Proof)" or "12". */
  alcoholContent: z.string().min(1),
  /** As written on the form, e.g. "750 MILLILITERS". */
  netContents: z.string().min(1),
  applicantNameAddress: z.string().min(1),
  countryOfOrigin: z.string().optional(),
  wineAppellation: z.string().optional(),
  wineVintage: z.string().optional(),
});
export type ColaApplication = z.infer<typeof ColaApplication>;

/** What the vision model reads off a label image. Null = not found on label. */
export const ExtractedLabel = z.object({
  brandName: z.string().nullable(),
  fancifulName: z.string().nullable(),
  classType: z.string().nullable(),
  alcoholContent: z.string().nullable(),
  netContents: z.string().nullable(),
  producerNameAddress: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
  wineAppellation: z.string().nullable(),
  wineVintage: z.string().nullable(),
  governmentWarning: z.object({
    present: z.boolean(),
    /** Verbatim text as it appears, including the heading. */
    text: z.string().nullable(),
    headingStyle: z.enum(["all_caps", "title_case", "other"]).nullable(),
  }),
  /** Model's own read-quality judgment; drives needs_review verdicts. */
  readability: z.enum(["clear", "partial", "unreadable"]),
});
export type ExtractedLabel = z.infer<typeof ExtractedLabel>;

export const FieldKey = z.enum([
  "brandName",
  "fancifulName",
  "classType",
  "alcoholContent",
  "netContents",
  "producerNameAddress",
  "countryOfOrigin",
  "wineAppellation",
  "wineVintage",
  "governmentWarning",
]);
export type FieldKey = z.infer<typeof FieldKey>;

export const VerdictStatus = z.enum([
  "match", // exact after normalization
  "close_match", // judgment-tier equivalence (case, punctuation, formatting)
  "mismatch", // substantive difference
  "missing_on_label", // required by application, absent from label
  "needs_review", // machine can't decide (e.g. unreadable image region)
  "not_applicable", // field not required for this beverage type / application
]);
export type VerdictStatus = z.infer<typeof VerdictStatus>;

export const FieldVerdict = z.object({
  field: FieldKey,
  status: VerdictStatus,
  applicationValue: z.string().nullable(),
  labelValue: z.string().nullable(),
  reason: z.string(),
});
export type FieldVerdict = z.infer<typeof FieldVerdict>;

export const MatchReport = z.object({
  matchPercentage: z.number().min(0).max(100),
  verdicts: z.array(FieldVerdict),
  overall: z.enum(["all_match", "needs_review", "has_mismatches"]),
  summary: z.string(),
});
export type MatchReport = z.infer<typeof MatchReport>;

/** API: POST /api/verify response. */
export const VerifyResponse = z.object({
  ok: z.literal(true),
  extracted: ExtractedLabel,
  report: MatchReport,
  elapsedMs: z.number(),
  /** Model token usage for this extraction — drives measured cost estimates. */
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number() })
    .optional(),
});
export type VerifyResponse = z.infer<typeof VerifyResponse>;

export const ApiError = z.object({
  ok: z.literal(false),
  error: z.string(),
  /**
   * True when the failure is transient (429/5xx/timeout/network) and the same
   * request may succeed on retry. Refusals, validation and contract violations
   * are never retryable. The streamed response is HTTP 200 by the time a
   * terminal error line arrives, so retry logic keys off this field.
   */
  retryable: z.boolean().optional(),
});
export type ApiError = z.infer<typeof ApiError>;

/**
 * Progress events streamed (NDJSON) by /api/verify ahead of the final
 * VerifyResponse — real signals, emitted when each phase actually starts.
 */
export const StageEvent = z.object({
  stage: z.enum(["extracting", "matching"]),
});
export type StageEvent = z.infer<typeof StageEvent>;

/** API: GET /api/cola/[ttbid] success — registry prefill. */
export const ColaPrefillResponse = z.object({
  ok: z.literal(true),
  ttbid: z.string(),
  /** "live" = fetched from ttbonline.gov just now; "cached" = committed fixture fallback. */
  source: z.enum(["live", "cached"]),
  application: ColaApplication,
});
export type ColaPrefillResponse = z.infer<typeof ColaPrefillResponse>;

/** A generated mock application + matching (or deliberately flawed) label spec. */
export const GeneratedCase = z.object({
  application: ColaApplication,
  /** Field values as they should be rendered on the label. */
  label: ExtractedLabel,
  /** Defects deliberately injected (empty = clean pair). */
  injectedDefects: z.array(
    z.object({ field: FieldKey, description: z.string() })
  ),
});
export type GeneratedCase = z.infer<typeof GeneratedCase>;

/** The exact mandatory health warning text, 27 CFR Part 16. */
export const GOVERNMENT_WARNING_HEADING = "GOVERNMENT WARNING:";
export const GOVERNMENT_WARNING_BODY =
  "(1) According to the Surgeon General, women should not drink alcoholic beverages during pregnancy because of the risk of birth defects. (2) Consumption of alcoholic beverages impairs your ability to drive a car or operate machinery, and may cause health problems.";
