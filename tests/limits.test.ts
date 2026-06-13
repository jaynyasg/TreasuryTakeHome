import { describe, expect, it } from "vitest";
import {
  resolveLimits,
  checkSpend,
  DEFAULT_LIMITS,
  LIMIT_ENV_VAR,
  type LimitsEnv,
} from "@/lib/config/limits";

describe("resolveLimits defaults", () => {
  it("returns the documented defaults when env is empty", () => {
    expect(resolveLimits({})).toEqual(DEFAULT_LIMITS);
  });

  it("encodes the plan's SLO targets (latency targets)", () => {
    const { slo } = resolveLimits({});
    expect(slo).toEqual({
      singleCaseP50Ms: 5_000,
      preflight300Ms: 10_000,
      firstDurableResultMs: 60_000,
      batch50CompletionMs: 600_000,
      batch300CompletionMs: 2_700_000,
    });
  });

  it("keeps SLO targets fixed (not env-overridable)", () => {
    const env: LimitsEnv = { SINGLE_CASE_P50_MS: "1" };
    expect(resolveLimits(env).slo.singleCaseP50Ms).toBe(5_000);
  });
});

describe("resolveLimits env overrides", () => {
  it("overrides per-stage concurrency caps", () => {
    const env: LimitsEnv = {
      [LIMIT_ENV_VAR.intakeConcurrency]: "10",
      [LIMIT_ENV_VAR.modelConcurrency]: "2",
      [LIMIT_ENV_VAR.scoringConcurrency]: "16",
      [LIMIT_ENV_VAR.evidenceConcurrency]: "16",
      [LIMIT_ENV_VAR.exportConcurrency]: "3",
      [LIMIT_ENV_VAR.replayConcurrency]: "1",
    };
    expect(resolveLimits(env).concurrency).toEqual({
      intake: 10,
      model: 2,
      scoring: 16,
      evidence: 16,
      export: 3,
      replay: 1,
    });
  });

  it("overrides spend caps", () => {
    const env: LimitsEnv = {
      [LIMIT_ENV_VAR.dailySpendUsd]: "100",
      [LIMIT_ENV_VAR.perBatchSpendUsd]: "12.5",
    };
    expect(resolveLimits(env).spend).toEqual({
      dailyUsd: 100,
      perBatchUsd: 12.5,
    });
  });

  it("allows a zero spend cap (hard brake) but not negative", () => {
    expect(
      resolveLimits({ [LIMIT_ENV_VAR.dailySpendUsd]: "0" }).spend.dailyUsd,
    ).toBe(0);
    // Negative falls back to the default.
    expect(
      resolveLimits({ [LIMIT_ENV_VAR.dailySpendUsd]: "-5" }).spend.dailyUsd,
    ).toBe(DEFAULT_LIMITS.spend.dailyUsd);
  });

  it("ignores invalid / non-positive concurrency overrides (falls back)", () => {
    for (const bad of ["", "0", "-3", "abc", "NaN"]) {
      expect(
        resolveLimits({ [LIMIT_ENV_VAR.modelConcurrency]: bad }).concurrency
          .model,
      ).toBe(DEFAULT_LIMITS.concurrency.model);
    }
  });

  it("floors fractional concurrency overrides", () => {
    expect(
      resolveLimits({ [LIMIT_ENV_VAR.modelConcurrency]: "3.9" }).concurrency
        .model,
    ).toBe(3);
  });
});

describe("checkSpend", () => {
  it("is ok strictly under the cap", () => {
    const out = checkSpend(5, 20);
    expect(out.ok).toBe(true);
    expect(out.exceeded).toBe(false);
    expect(out.remainingUsd).toBe(15);
  });

  it("is exceeded exactly AT the cap (inclusive boundary)", () => {
    const out = checkSpend(20, 20);
    expect(out.ok).toBe(false);
    expect(out.exceeded).toBe(true);
    expect(out.remainingUsd).toBe(0);
  });

  it("is exceeded over the cap with clamped remaining", () => {
    const out = checkSpend(25, 20);
    expect(out.exceeded).toBe(true);
    expect(out.remainingUsd).toBe(0);
  });

  it("treats non-finite / negative spend as zero", () => {
    expect(checkSpend(Number.NaN, 20).ok).toBe(true);
    expect(checkSpend(-5, 20).remainingUsd).toBe(20);
  });

  it("treats a zero/invalid cap as already exceeded", () => {
    expect(checkSpend(0, 0).exceeded).toBe(true);
    expect(checkSpend(1, Number.NaN).exceeded).toBe(true);
  });
});
