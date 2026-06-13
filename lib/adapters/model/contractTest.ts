import { describe, expect, it } from "vitest";
import { ExtractedLabel } from "@/lib/contract";
import type {
  LabelExtractionInput,
  ModelAdapter,
  ModelExtractionError,
} from "@/lib/adapters/model/types";

/**
 * Shared behavior-level contract test for MODEL adapters (eng-review:
 * "storage, queue, and model adapters must share behavior-level contract
 * tests"). Fake/stub and real staging adapters must satisfy the same
 * semantics: a success returns contract-valid data, and malformed / refusal /
 * empty map to the matching {ok:false} error WITHOUT throwing.
 */

/** A factory + the outcome it is configured to produce. */
export interface AdapterCase {
  /** Builds a fresh adapter configured for the described outcome. */
  makeAdapter: () => ModelAdapter;
}

export interface ModelContractFixtures {
  /** An adapter configured to return a contract-valid extraction (ok:true). */
  valid: AdapterCase;
  /** An adapter configured to return a malformed failure (ok:false, "malformed"). */
  malformed: AdapterCase;
  /** An adapter configured to return a refusal failure (ok:false, "refusal"). */
  refusal: AdapterCase;
  /** Optional: an adapter configured to return an empty failure (ok:false, "empty"). */
  empty?: AdapterCase;
}

const SAMPLE_INPUT: LabelExtractionInput = {
  imageBase64: "aGk=", // "hi" — never decoded by stub adapters
  mimeType: "image/png",
};

/**
 * Run the shared model-adapter contract against a set of configured adapters.
 *
 * @param name      Suite label (e.g. "createStubModel").
 * @param _makeAdapter Reserved hook for adapters that need shared setup; the
 *                  per-outcome factories in `fixtures` are authoritative.
 * @param fixtures  Adapters pre-configured for each asserted outcome.
 */
export function runModelContract(
  name: string,
  _makeAdapter: () => ModelAdapter,
  fixtures: ModelContractFixtures
): void {
  void _makeAdapter;

  describe(`model adapter contract: ${name}`, () => {
    it("returns contract-valid data on success (ok:true)", async () => {
      const adapter = fixtures.valid.makeAdapter();
      const result = await adapter.extractLabel(SAMPLE_INPUT);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error("expected ok:true");
      // Re-parse with the zod schema to PROVE the data is contract-valid.
      const reparsed = ExtractedLabel.safeParse(result.data);
      expect(reparsed.success).toBe(true);
    });

    it("maps malformed output to ok:false error:'malformed' without throwing", async () => {
      const adapter = fixtures.malformed.makeAdapter();
      const result = await adapter.extractLabel(SAMPLE_INPUT);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected ok:false");
      expectError(result.error, "malformed");
    });

    it("maps a refusal to ok:false error:'refusal' without throwing", async () => {
      const adapter = fixtures.refusal.makeAdapter();
      const result = await adapter.extractLabel(SAMPLE_INPUT);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected ok:false");
      expectError(result.error, "refusal");
    });

    if (fixtures.empty) {
      const emptyCase = fixtures.empty;
      it("maps an empty response to ok:false error:'empty' without throwing", async () => {
        const adapter = emptyCase.makeAdapter();
        const result = await adapter.extractLabel(SAMPLE_INPUT);
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("expected ok:false");
        expectError(result.error, "empty");
      });
    }
  });
}

function expectError(actual: ModelExtractionError, expected: ModelExtractionError): void {
  expect(actual).toBe(expected);
}
