import { describe, expect, it } from "vitest";
import {
  isDurableBatchEnabled,
  isWorkerProcessingDisabled,
  areModelCallsDisabled,
  isReplayDisabled,
  areExportsDisabled,
  isPurgeKillSwitchOn,
  isKillSwitchOn,
  featureFlagSnapshot,
  KILL_SWITCHES,
  KILL_SWITCH_ENV_VAR,
  type FlagEnv,
  type KillSwitch,
} from "@/lib/flags";

/** Every truthy spelling the contract accepts. */
const TRUTHY = ["1", "true", "TRUE", "on", "On", "yes", "  yes  "];
/** Representative falsey spellings (including "0" and unrelated text). */
const FALSEY = [undefined, "", "0", "false", "no", "off", "nope"];

describe("isDurableBatchEnabled", () => {
  it("is true only for an exact '1'", () => {
    expect(isDurableBatchEnabled({ DURABLE_BATCH: "1" })).toBe(true);
  });

  it("is false for other truthy-ish spellings (exact-1 contract)", () => {
    expect(isDurableBatchEnabled({ DURABLE_BATCH: "true" })).toBe(false);
    expect(isDurableBatchEnabled({ DURABLE_BATCH: "yes" })).toBe(false);
  });

  it("is false when unset", () => {
    expect(isDurableBatchEnabled({})).toBe(false);
  });
});

/** Table-driven: each kill switch predicate against its env var. */
const KILL_PREDICATES: ReadonlyArray<{
  name: KillSwitch;
  envVar: string;
  fn: (env?: FlagEnv) => boolean;
}> = [
  { name: "workerProcessing", envVar: "WORKER_PROCESSING_DISABLED", fn: isWorkerProcessingDisabled },
  { name: "modelCalls", envVar: "MODEL_CALLS_DISABLED", fn: areModelCallsDisabled },
  { name: "replay", envVar: "REPLAY_DISABLED", fn: isReplayDisabled },
  { name: "exports", envVar: "EXPORTS_DISABLED", fn: areExportsDisabled },
  { name: "purge", envVar: "PURGE_KILL_SWITCH", fn: isPurgeKillSwitchOn },
];

describe("kill-switch predicates", () => {
  for (const { name, envVar, fn } of KILL_PREDICATES) {
    describe(name, () => {
      for (const value of TRUTHY) {
        it(`is ON for ${JSON.stringify(value)}`, () => {
          expect(fn({ [envVar]: value })).toBe(true);
          expect(isKillSwitchOn(name, { [envVar]: value })).toBe(true);
        });
      }
      for (const value of FALSEY) {
        it(`is OFF for ${JSON.stringify(value)}`, () => {
          const env = value === undefined ? {} : { [envVar]: value };
          expect(fn(env)).toBe(false);
          expect(isKillSwitchOn(name, env)).toBe(false);
        });
      }
    });
  }
});

describe("KILL_SWITCHES / KILL_SWITCH_ENV_VAR", () => {
  it("maps every kill switch to a distinct env var", () => {
    const vars = KILL_SWITCHES.map((k) => KILL_SWITCH_ENV_VAR[k]);
    expect(new Set(vars).size).toBe(vars.length);
    expect(vars).toEqual([
      "WORKER_PROCESSING_DISABLED",
      "MODEL_CALLS_DISABLED",
      "REPLAY_DISABLED",
      "EXPORTS_DISABLED",
      "PURGE_KILL_SWITCH",
    ]);
  });

  it("isKillSwitchOn reads through the env-var mapping", () => {
    for (const name of KILL_SWITCHES) {
      const env = { [KILL_SWITCH_ENV_VAR[name]]: "1" };
      expect(isKillSwitchOn(name, env)).toBe(true);
    }
  });
});

describe("featureFlagSnapshot", () => {
  it("reports the all-default (nothing set) posture", () => {
    expect(featureFlagSnapshot({})).toEqual({
      durableBatch: false,
      workerProcessing: "on",
      modelCalls: "on",
      replay: "on",
      exports: "on",
      purge: "on",
    });
  });

  it("flips each posture to 'killed' when its brake is engaged", () => {
    const env: FlagEnv = {
      DURABLE_BATCH: "1",
      WORKER_PROCESSING_DISABLED: "1",
      MODEL_CALLS_DISABLED: "true",
      REPLAY_DISABLED: "on",
      EXPORTS_DISABLED: "yes",
      PURGE_KILL_SWITCH: "1",
    };
    expect(featureFlagSnapshot(env)).toEqual({
      durableBatch: true,
      workerProcessing: "killed",
      modelCalls: "killed",
      replay: "killed",
      exports: "killed",
      purge: "killed",
    });
  });

  it("is independent per-switch (only the engaged one flips)", () => {
    const snap = featureFlagSnapshot({ EXPORTS_DISABLED: "1" });
    expect(snap.exports).toBe("killed");
    expect(snap.workerProcessing).toBe("on");
    expect(snap.modelCalls).toBe("on");
    expect(snap.replay).toBe("on");
    expect(snap.purge).toBe("on");
    expect(snap.durableBatch).toBe(false);
  });
});
