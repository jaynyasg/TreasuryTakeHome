import type { KillSwitchIndicator } from "./killSwitches";
import StatusPill from "./StatusPill";

/**
 * Settings / Kill Switches panel (plan Admin IA + "Operational brakes"). Renders
 * the runtime kill-switch + feature-flag states as READ-ONLY indicators sourced
 * from env (`readKillSwitches`). Toggling is via ops/env, NOT in-app for this
 * prototype — the panel documents that explicitly and exposes the controlling
 * env var per row so an operator knows what to flip.
 *
 * Severity model (never color-only):
 *   - feature flags (durable batch): enabled = OK, disabled = neutral normal-off.
 *   - brakes (worker/model/replay/exports/purge): enabled = OK, disabled =
 *     warn (a brake is ENGAGED and some path is paused).
 */
export default function KillSwitchPanel({
  switches,
}: {
  switches: readonly KillSwitchIndicator[];
}) {
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Runtime kill switches and feature flags, read-only. {switches.length}{" "}
          controls.
        </caption>
        <thead>
          <tr className="border-b border-line bg-surface/60">
            {["Control", "State", "Env var", "What it gates"].map((h) => (
              <th
                key={h}
                scope="col"
                className="px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {switches.map((s) => (
            <tr
              key={s.key}
              className="border-b border-line last:border-b-0 hover:bg-surface/40"
            >
              <td className="px-3 py-3 align-top text-[13px] font-medium text-ink">
                {s.label}
              </td>
              <td className="px-3 py-3 align-top">{stateBadge(s)}</td>
              <td className="px-3 py-3 align-top">
                <span className="font-mono text-[11.5px] text-muted">
                  {s.envVar}
                </span>
              </td>
              <td className="max-w-[28rem] px-3 py-3 align-top text-[12.5px] text-ink-2">
                {s.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Severity-aware state badge: enabled = OK; disabled = warn (brake) or neutral. */
function stateBadge(s: KillSwitchIndicator) {
  if (s.state === "enabled") {
    return <StatusPill tone="ok">Enabled</StatusPill>;
  }
  // Disabled: a brake engaged is worth flagging (warn); a normal-off feature
  // flag is neutral.
  return (
    <StatusPill tone={s.disabledIsBrake ? "warn" : "neutral"}>
      Disabled
    </StatusPill>
  );
}
