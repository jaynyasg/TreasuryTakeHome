import { ExtractedLabel, GOVERNMENT_WARNING_BODY, GOVERNMENT_WARNING_HEADING } from "@/lib/contract";
import type {
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
 * Configured outcome for a stub adapter. Either a successful fixture extraction
 * (defaults to DEFAULT_STUB_LABEL) or a configured failure.
 */
export type StubModelConfig = ExtractedLabel | ModelExtractionResult;

function toResult(config: StubModelConfig | undefined): ModelExtractionResult {
  if (config === undefined) return { ok: true, data: DEFAULT_STUB_LABEL };
  // A ModelExtractionResult has a boolean `ok`; an ExtractedLabel never does.
  if (typeof (config as { ok?: unknown }).ok === "boolean") {
    return config as ModelExtractionResult;
  }
  return { ok: true, data: config as ExtractedLabel };
}

/**
 * Build a deterministic ModelAdapter that resolves to a fixed outcome.
 *
 *   createStubModel()                                  -> ok:true, DEFAULT_STUB_LABEL
 *   createStubModel(myLabel)                           -> ok:true, myLabel
 *   createStubModel({ ok: false, error: "malformed" }) -> ok:false failure
 */
export function createStubModel(config?: StubModelConfig): ModelAdapter {
  const result = toResult(config);
  return {
    async extractLabel(_input: LabelExtractionInput): Promise<ModelExtractionResult> {
      void _input;
      return result;
    },
  };
}
