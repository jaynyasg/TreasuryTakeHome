import type { OpsClassification, HealthLevel } from "@/lib/view/admin";

/**
 * Compact health-tile strip for the Operations Health landing (plan
 * "Operations Console" + Anti-Generic UI Constraints: "health tiles are compact
 * summaries", the tables carry the work). Pure presentational — it renders the
 * already-classified tile set from `classifyOps` and never reads thresholds or
 * `Date.now()` itself (the server page injects `now`).
 *
 * Accessibility: each tile pairs its severity with a TEXT level word and a shape
 * glyph (never color-only); the grid is a plain list of summaries, not a
 * decorative feature grid.
 */

const LEVEL: Record<HealthLevel, { ring: string; glyph: string; word: string }> = {
  ok: { ring: "border-accent-green/40", glyph: "✓", word: "OK" },
  warn: { ring: "border-accent-amber/50", glyph: "▲", word: "Warn" },
  alert: { ring: "border-accent-red/50", glyph: "!", word: "Alert" },
};

export default function OpsHealthStrip({
  classification,
}: {
  classification: OpsClassification;
}) {
  return (
    <ul
      className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4"
      aria-label="Operations health summary"
    >
      {classification.tiles.map((tile) => {
        const l = LEVEL[tile.level];
        return (
          <li
            key={tile.key}
            className={
              "flex flex-col gap-1 rounded-card border bg-card p-3 " + l.ring
            }
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">
                {tile.label}
              </span>
              <span
                className={
                  "inline-flex items-center gap-1 rounded-pill border px-1.5 py-[1px] text-[10px] font-semibold " +
                  l.ring
                }
              >
                <span aria-hidden>{l.glyph}</span>
                {l.word}
              </span>
            </div>
            <span className="text-[18px] font-semibold tracking-tight text-ink">
              {tile.value}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
