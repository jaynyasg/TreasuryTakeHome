/**
 * ONE typed source of truth for feature flags + runtime kill switches
 * (plan `docs/designs/production-gap-closure.md`).
 *
 * Consolidates the env-flag interpretation that is currently scattered across
 * `components/admin/killSwitches.ts`, `app/api/intake/_session.ts`,
 * `middleware.ts`/`auth.config.ts`, and the worker. Two posture families are
 * encoded here:
 *
 *   - **Rollout posture** (plan "Rollout posture"): durable batch ships behind a
 *     feature flag; disabling it stops NEW durable batches while existing jobs
 *     drain/pause/replay through admin controls. → {@link isDurableBatchEnabled}.
 *
 *   - **Operational brakes** (plan "Operational brakes": runtime kill switches
 *     for durable batch intake, worker processing, model calls, replay, exports,
 *     and purge). → the `is*Disabled` / `is*KillSwitchOn` predicates below.
 *
 * Pure + framework-free (NO React, NO Next, NO I/O): every reader takes an
 * injectable `env` (defaulting to `process.env`) so a server component, a server
 * action, the worker, and a unit test all interpret the same contract
 * identically and deterministically.
 *
 * Env contract (all optional; default = feature OFF / brake DISENGAGED):
 *   - `DURABLE_BATCH`              — "1" enables the durable batch path (and the
 *                                    whole reviewer/admin area). Absent ⇒ off.
 *                                    EXACT "1" match (mirrors existing callers).
 *   - `WORKER_PROCESSING_DISABLED` — truthy ⇒ worker stops claiming/processing
 *                                    queued case jobs (brake engaged).
 *   - `MODEL_CALLS_DISABLED`       — truthy ⇒ worker model (LLM) calls paused.
 *   - `REPLAY_DISABLED`            — truthy ⇒ admin dead-letter/failed replay
 *                                    paused.
 *   - `EXPORTS_DISABLED`           — truthy ⇒ point-in-time export generation
 *                                    paused.
 *   - `PURGE_KILL_SWITCH`          — truthy ⇒ phase-two retention purge deletes
 *                                    NOTHING.
 *
 * "Truthy" matches the existing `components/admin/killSwitches.ts` semantics:
 * "1", "true", "on", "yes" (case-insensitive, trimmed).
 */

/** The injectable environment shape (a subset of `process.env`). */
export type FlagEnv = Record<string, string | undefined>;

/**
 * Truthy env interpretation: "1", "true", "on", "yes" (case-insensitive,
 * trimmed). Matches `components/admin/killSwitches.ts` so the admin Settings
 * panel and the runtime brakes agree on "engaged".
 */
function envTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/**
 * Resolve the env source. Defaulting at call-time (NOT module load) keeps the
 * module side-effect-free and lets tests inject a frozen env.
 */
function resolveEnv(env?: FlagEnv): FlagEnv {
  return env ?? process.env;
}

/**
 * True when the durable-batch feature flag is enabled (plan "Rollout posture").
 * EXACT `"1"` match to mirror the existing `_session.ts` / killSwitches callers
 * — anything else (or unset) keeps the public single/small-upload path the only
 * active flow and the reviewer/admin area gated off.
 */
export function isDurableBatchEnabled(env?: FlagEnv): boolean {
  return resolveEnv(env).DURABLE_BATCH === "1";
}

/**
 * True when worker processing is paused (`WORKER_PROCESSING_DISABLED` truthy).
 * Gates the worker poll loop claiming/processing queued case jobs.
 */
export function isWorkerProcessingDisabled(env?: FlagEnv): boolean {
  return envTruthy(resolveEnv(env).WORKER_PROCESSING_DISABLED);
}

/**
 * True when model (LLM) calls are paused (`MODEL_CALLS_DISABLED` truthy). Gates
 * the worker extraction/judgment model calls.
 */
export function areModelCallsDisabled(env?: FlagEnv): boolean {
  return envTruthy(resolveEnv(env).MODEL_CALLS_DISABLED);
}

/**
 * True when admin replay is paused (`REPLAY_DISABLED` truthy). Gates admin
 * replay of dead-letter / failed cases.
 */
export function isReplayDisabled(env?: FlagEnv): boolean {
  return envTruthy(resolveEnv(env).REPLAY_DISABLED);
}

/**
 * True when export generation is paused (`EXPORTS_DISABLED` truthy). Gates
 * point-in-time export artifact generation.
 */
export function areExportsDisabled(env?: FlagEnv): boolean {
  return envTruthy(resolveEnv(env).EXPORTS_DISABLED);
}

/**
 * True when the retention purge kill switch is ENGAGED (`PURGE_KILL_SWITCH`
 * truthy) — approving a phase-two purge then deletes nothing.
 */
export function isPurgeKillSwitchOn(env?: FlagEnv): boolean {
  return envTruthy(resolveEnv(env).PURGE_KILL_SWITCH);
}

/**
 * The runtime kill switches (plan "Operational brakes"). Excludes the durable
 * batch FEATURE flag, which is rollout posture rather than a brake.
 */
export type KillSwitch =
  | "workerProcessing"
  | "modelCalls"
  | "replay"
  | "exports"
  | "purge";

/** Stable, iterable list of every kill switch in operational order. */
export const KILL_SWITCHES: readonly KillSwitch[] = [
  "workerProcessing",
  "modelCalls",
  "replay",
  "exports",
  "purge",
] as const;

/** The env var that controls each kill switch (single source of mapping). */
export const KILL_SWITCH_ENV_VAR: Readonly<Record<KillSwitch, string>> = {
  workerProcessing: "WORKER_PROCESSING_DISABLED",
  modelCalls: "MODEL_CALLS_DISABLED",
  replay: "REPLAY_DISABLED",
  exports: "EXPORTS_DISABLED",
  purge: "PURGE_KILL_SWITCH",
};

/**
 * Generic predicate: true when the named kill switch's brake is ENGAGED. Reads
 * the mapped env var via the shared truthy interpretation, so callers can gate
 * on a `KillSwitch` value without hard-coding env var names.
 */
export function isKillSwitchOn(name: KillSwitch, env?: FlagEnv): boolean {
  return envTruthy(resolveEnv(env)[KILL_SWITCH_ENV_VAR[name]]);
}

/** A kill switch's runtime posture: `on` = killed/brake engaged. */
export type SwitchPosture = "on" | "killed";

/**
 * The read model for the admin Settings panel: durable-batch flag posture plus
 * each kill switch as `on` (running normally) or `killed` (brake engaged). One
 * deterministic snapshot the Settings indicators render from.
 */
export interface FeatureFlagSnapshot {
  /** Rollout posture: true when the durable batch path is enabled. */
  durableBatch: boolean;
  /** Worker job processing. */
  workerProcessing: SwitchPosture;
  /** Worker model (LLM) calls. */
  modelCalls: SwitchPosture;
  /** Admin dead-letter / failed replay. */
  replay: SwitchPosture;
  /** Point-in-time export generation. */
  exports: SwitchPosture;
  /** Phase-two retention purge. */
  purge: SwitchPosture;
}

/** Map a kill switch's engaged-state to its Settings posture label. */
function posture(killed: boolean): SwitchPosture {
  return killed ? "killed" : "on";
}

/**
 * Snapshot every feature flag + kill switch for the admin Settings panel. Pure
 * and deterministic for a given `env` — the panel renders these directly.
 */
export function featureFlagSnapshot(env?: FlagEnv): FeatureFlagSnapshot {
  const e = resolveEnv(env);
  return {
    durableBatch: isDurableBatchEnabled(e),
    workerProcessing: posture(isWorkerProcessingDisabled(e)),
    modelCalls: posture(areModelCallsDisabled(e)),
    replay: posture(isReplayDisabled(e)),
    exports: posture(areExportsDisabled(e)),
    purge: posture(isPurgeKillSwitchOn(e)),
  };
}
