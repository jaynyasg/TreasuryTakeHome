import { describe, expect, it } from "vitest";
import { ExtractedLabel } from "@/lib/contract";
import { runModelContract } from "@/lib/adapters/model/contractTest";
import { createStubModel, DEFAULT_STUB_LABEL } from "@/lib/adapters/model/stub";

/**
 * Runs the shared model-adapter contract against the stub adapter. The stub is
 * the only adapter exercised here — the OpenAI adapter is typecheck-only and
 * must never call OpenAI during `npm run verify`.
 */
runModelContract("createStubModel", () => createStubModel(), {
  valid: { makeAdapter: () => createStubModel(DEFAULT_STUB_LABEL) },
  malformed: { makeAdapter: () => createStubModel({ ok: false, error: "malformed", raw: "not json" }) },
  refusal: { makeAdapter: () => createStubModel({ ok: false, error: "refusal", raw: "Model refused: policy" }) },
  empty: { makeAdapter: () => createStubModel({ ok: false, error: "empty" }) },
});

describe("createStubModel defaults & passthrough", () => {
  it("defaults to a contract-valid extraction when unconfigured", async () => {
    const result = await createStubModel().extractLabel({ imageBase64: "aGk=", mimeType: "image/png" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(ExtractedLabel.safeParse(result.data).success).toBe(true);
  });

  it("returns a provided fixture verbatim", async () => {
    const fixture: ExtractedLabel = { ...DEFAULT_STUB_LABEL, brandName: "OTIUM CELLARS" };
    const result = await createStubModel(fixture).extractLabel({ imageBase64: "aGk=", mimeType: "image/png" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok:true");
    expect(result.data.brandName).toBe("OTIUM CELLARS");
  });

  it("is deterministic across calls", async () => {
    const adapter = createStubModel({ ok: false, error: "timeout" });
    const a = await adapter.extractLabel({ imageBase64: "aGk=", mimeType: "image/png" });
    const b = await adapter.extractLabel({ imageBase64: "Ynll", mimeType: "image/jpeg" });
    expect(a).toEqual(b);
  });
});
