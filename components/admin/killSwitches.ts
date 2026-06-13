/**
 * Runtime kill-switch + feature-flag READ MODEL for the admin Settings tab and
 * the purge action (plan "Operational brakes": runtime kill switches for durable
 * batch intake, worker processing, model calls, replay, exports, and purge).
 *
 * For this prototype these are sourced from ENVIRONMENT VARIABLES and are
 * READ-ONLY in-app — toggling happens via ops/env, never through a button in the
 * console (documented on the Settings page). This module is the single place
 * that interprets the env contract so the Settings indicators and the purge
 * action agree on what "engaged" means.
 *
 * Env contract (all optional; default = enabled / switch-OFF):
 *   - `DURABLE_BATCH`              "1" enables the durable batch path (and the
 *                                  whole reviewer/admin area). Absent ⇒ disabled.
 *   - `WORKER_PROCESSING_DISABLED` truthy ⇒ worker processing paused.
 *   - `MODEL_CALLS_DISABLED`       truthy ⇒ model calls paused.
 *   - `REPLAY_DISABLED`            truthy ⇒ admin replay paused.
 *   - `EXPORTS_DISABLED`           truthy ⇒ export generation paused.
 *   - `PURGE_KILL_SWITCH`          truthy ⇒ retention purge deletes NOTHING.
 *
 * Pure + framework-free (no React, no Next imports) so a server component, a
 * server action, and a unit test can all read the same posture.
 */

/** A switch's runtime posture as shown in the Settings tab. */
export type SwitchState = "enabled" | "disabled";

/** One labeled kill switch / feature flag indicator. */
export interface KillSwitchIndicator {
  /** Stable key for React keys + tests. */
  key: string;
  /** Human label, e.g. "Worker processing". */
  label: string;
  /** The env var that controls it (shown so ops knows what to flip). */
  envVar: string;
  /** Current posture. */
  state: SwitchState;
  /**
   * Whether `disabled` is the OK/normal state for this control. For feature
   * flags (durable batch) disabled is normal-off; for brakes (purge kill switch)
   * disabled means a brake is ENGAGED and is worth flagging.
   */
  disabledIsBrake: boolean;
  /** One-line description of what the switch gates. */
  description: string;
}

/** Truthy env interpretation: "1", "true", "on", "yes" (case-insensitive). */
function envTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** True when the durable-batch feature flag is enabled. */
export function isDurableBatchEnabled(): boolean {
  return process.env.DURABLE_BATCH === "1";
}

/** True when the retention purge kill switch is ENGAGED (purge deletes nothing). */
export function isPurgeKillSwitchOn(): boolean {
  return envTruthy(process.env.PURGE_KILL_SWITCH);
}

/**
 * Snapshot every kill switch / feature flag for the read-only Settings panel,
 * in operational order (the highest-signal brakes last). The Settings page
 * renders these as indicators with no toggle affordance.
 */
export function readKillSwitches(): KillSwitchIndicator[] {
  return [
    {
      key: "durableBatch",
      label: "Durable batch intake",
      envVar: "DURABLE_BATCH",
      state: isDurableBatchEnabled() ? "enabled" : "disabled",
      disabledIsBrake: false,
      description:
        "Feature flag for the durable batch intake path and the reviewer/admin area.",
    },
    {
      key: "workerProcessing",
      label: "Worker processing",
      envVar: "WORKER_PROCESSING_DISABLED",
      state: envTruthy(process.env.WORKER_PROCESSING_DISABLED)
        ? "disabled"
        : "enabled",
      disabledIsBrake: true,
      description: "Background worker claims and processes queued case jobs.",
    },
    {
      key: "modelCalls",
      label: "Model calls",
      envVar: "MODEL_CALLS_DISABLED",
      state: envTruthy(process.env.MODEL_CALLS_DISABLED)
        ? "disabled"
        : "enabled",
      disabledIsBrake: true,
      description: "Worker model (LLM) extraction calls.",
    },
    {
      key: "replay",
      label: "Admin replay",
      envVar: "REPLAY_DISABLED",
      state: envTruthy(process.env.REPLAY_DISABLED) ? "disabled" : "enabled",
      disabledIsBrake: true,
      description: "Admin replay of dead-letter / failed cases.",
    },
    {
      key: "exports",
      label: "Export generation",
      envVar: "EXPORTS_DISABLED",
      state: envTruthy(process.env.EXPORTS_DISABLED) ? "disabled" : "enabled",
      disabledIsBrake: true,
      description: "Point-in-time export artifact generation.",
    },
    {
      key: "purge",
      label: "Retention purge",
      envVar: "PURGE_KILL_SWITCH",
      state: isPurgeKillSwitchOn() ? "disabled" : "enabled",
      disabledIsBrake: true,
      description:
        "Phase-two retention purge. When engaged, approving a purge deletes nothing.",
    },
  ];
}
