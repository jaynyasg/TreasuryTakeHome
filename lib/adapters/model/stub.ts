import {
  ColaApplication,
  ExtractedLabel,
  GOVERNMENT_WARNING_BODY,
  GOVERNMENT_WARNING_HEADING,
} from "@/lib/contract";
import type {
  ApplicationExtractionInput,
  ApplicationExtractionResult,
  LabelExtractionInput,
  ModelAdapter,
  ModelExtractionResult,
} from "@/lib/adapters/model/types";

/**
 * Deterministic in-memory model adapter for tests and the local worker harness.
 * No I/O, no OpenAI client. Configure it with a fixed outcome (a fixture
 * extraction for ok:true, or a failure result for ok:false) and it returns that
 * outcome for every call.
 */

/** A small, contract-valid default extraction — proven valid by re-parsing below. */
export const DEFAULT_STUB_LABEL: ExtractedLabel = ExtractedLabel.parse({
  brandName: "OLD TOM DISTILLERY",
  fancifulName: null,
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  producerNameAddress: "Old Tom Distillery, Louisville, KY",
  countryOfOrigin: null,
  wineAppellation: null,
  wineVintage: null,
  governmentWarning: {
    present: true,
    text: `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY}`,
    headingStyle: "all_caps",
  },
  readability: "clear",
});

/**
 * A small, contract-valid default application — proven valid by re-parsing
 * below. Consistent with DEFAULT_STUB_LABEL (same OLD TOM DISTILLERY bourbon) so
 * a default stub — label AND application both default — scores a CLEAN match.
 */
export const DEFAULT_STUB_APPLICATION: ColaApplication = ColaApplication.parse({
  serialNumber: "12345001000123",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  applicantNameAddress: "Old Tom Distillery, Louisville, KY",
});

/**
 * Configured outcome for a stub adapter. Either a successful fixture extraction
 * (defaults to DEFAULT_STUB_LABEL) or a configured failure.
 */
export type StubModelConfig = ExtractedLabel | ModelExtractionResult;

/**
 * Configured outcome for the stub's application extraction. Either a successful
 * fixture application (defaults to DEFAULT_STUB_APPLICATION) or a configured
 * failure result.
 */
export type StubApplicationConfig = ColaApplication | ApplicationExtractionResult;

function toResult(config: StubModelConfig | undefined): ModelExtractionResult {
  if (config === undefined) return { ok: true, data: DEFAULT_STUB_LABEL };
  // A ModelExtractionResult has a boolean `ok`; an ExtractedLabel never does.
  if (typeof (config as { ok?: unknown }).ok === "boolean") {
    return config as ModelExtractionResult;
  }
  return { ok: true, data: config as ExtractedLabel };
}

function toApplicationResult(
  config: StubApplicationConfig | undefined
): ApplicationExtractionResult {
  if (config === undefined) return { ok: true, data: DEFAULT_STUB_APPLICATION };
  // An ApplicationExtractionResult has a boolean `ok`; a ColaApplication never does.
  if (typeof (config as { ok?: unknown }).ok === "boolean") {
    return config as ApplicationExtractionResult;
  }
  return { ok: true, data: config as ColaApplication };
}

/**
 * Build a deterministic ModelAdapter that resolves to a fixed outcome.
 *
 *   createStubModel()                                  -> label ok:true DEFAULT_STUB_LABEL,
 *                                                         application ok:true DEFAULT_STUB_APPLICATION
 *   createStubModel(myLabel)                           -> label ok:true, myLabel
 *   createStubModel({ ok: false, error: "malformed" }) -> label ok:false failure
 *
 * Pass `opts.application` to override the application outcome independently:
 *   createStubModel(undefined, { application: { ok: false, error: "timeout" } })
 */
export function createStubModel(
  config?: StubModelConfig,
  opts: { application?: StubApplicationConfig } = {}
): ModelAdapter {
  const result = toResult(config);
  const applicationResult = toApplicationResult(opts.application);
  return {
    async extractLabel(_input: LabelExtractionInput): Promise<ModelExtractionResult> {
      void _input;
      return result;
    },
    async extractApplication(
      _input: ApplicationExtractionInput
    ): Promise<ApplicationExtractionResult> {
      void _input;
      return applicationResult;
    },
  };
}
