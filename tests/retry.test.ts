import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyCase, VerifyError } from "@/lib/client";
import { OTIUM_APPLICATION } from "@/lib/fixtures";
import { GOVERNMENT_WARNING_BODY, GOVERNMENT_WARNING_HEADING } from "@/lib/contract";

const GOOD_TERMINAL = {
  ok: true,
  extracted: {
    brandName: "OTIUM CELLARS",
    fancifulName: null,
    classType: "Pinot Gris",
    alcoholContent: "12% ALC/VOL",
    netContents: "750 mL",
    producerNameAddress: null,
    countryOfOrigin: null,
    wineAppellation: null,
    wineVintage: null,
    governmentWarning: {
      present: true,
      text: `${GOVERNMENT_WARNING_HEADING} ${GOVERNMENT_WARNING_BODY}`,
      headingStyle: "all_caps",
    },
    readability: "clear",
  },
  report: { matchPercentage: 100, verdicts: [], overall: "all_match", summary: "ok" },
  elapsedMs: 1000,
};

function ndjsonResponse(lines: unknown[]): Response {
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  return new Response(body, { status: 200, headers: { "Content-Type": "application/x-ndjson" } });
}

const IMAGES = ["data:image/png;base64,aGk="];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyCase retry seam (T2+T3 / eng-review 1A)", () => {
  it("retries a retryable terminal error and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ndjsonResponse([{ stage: "extracting" }, { ok: false, error: "rate limited", retryable: true }])
      )
      .mockResolvedValueOnce(
        ndjsonResponse([{ stage: "extracting" }, { stage: "matching" }, GOOD_TERMINAL])
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyCase(OTIUM_APPLICATION, IMAGES);
    expect(result.report.matchPercentage).toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does NOT retry a non-retryable terminal error", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        ndjsonResponse([{ stage: "extracting" }, { ok: false, error: "Model refused", retryable: false }])
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyCase(OTIUM_APPLICATION, IMAGES)).rejects.toThrow("Model refused");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives up after 3 attempts and surfaces a retryable VerifyError", async () => {
    const fetchMock = vi
      .fn()
      .mockImplementation(async () =>
        ndjsonResponse([{ ok: false, error: "upstream 503", retryable: true }])
      );
    vi.stubGlobal("fetch", fetchMock);

    const err = await verifyCase(OTIUM_APPLICATION, IMAGES).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VerifyError);
    expect((err as VerifyError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  }, 15000);

  it("treats network-level fetch failure as retryable", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(ndjsonResponse([GOOD_TERMINAL]));
    vi.stubGlobal("fetch", fetchMock);

    const result = await verifyCase(OTIUM_APPLICATION, IMAGES);
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("forwards stage events across retries", async () => {
    const stages: string[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        ndjsonResponse([{ stage: "extracting" }, { ok: false, error: "429", retryable: true }])
      )
      .mockResolvedValueOnce(
        ndjsonResponse([{ stage: "extracting" }, { stage: "matching" }, GOOD_TERMINAL])
      );
    vi.stubGlobal("fetch", fetchMock);

    await verifyCase(OTIUM_APPLICATION, IMAGES, (s) => stages.push(s));
    expect(stages).toEqual(["extracting", "extracting", "matching"]);
  });
});
