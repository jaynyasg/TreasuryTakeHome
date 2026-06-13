import { type ReactNode } from "react";
import type { HealthLevel } from "@/lib/view/admin";
import type { StatusTone } from "./format";

/**
 * Severity pill shared across the admin tables (plan Accessibility:
 * "Severity is never conveyed by color alone; pair red/amber/green with
 * labels/icons/text"). Every pill carries BOTH a shape token (the leading glyph)
 * AND a text label, so it reads correctly without color and for screen readers.
 *
 * `tone` accepts the view nucleus's {@link HealthLevel} (ok/warn/alert) plus a
 * "neutral" tone for informational states (e.g. an export still generating).
 */
export type PillTone = HealthLevel | StatusTone;

const TONE: Record<PillTone, { pill: string; glyph: string; sr: string }> = {
  ok: {
    pill: "border-accent-green/40 bg-accent-green/10 text-ink",
    glyph: "✓",
    sr: "healthy",
  },
  warn: {
    pill: "border-accent-amber/50 bg-accent-amber/10 text-ink",
    glyph: "▲",
    sr: "warning",
  },
  alert: {
    pill: "border-accent-red/40 bg-accent-red/10 text-ink",
    glyph: "!",
    sr: "alert",
  },
  neutral: {
    pill: "border-line bg-surface text-ink-2",
    glyph: "•",
    sr: "informational",
  },
};

export default function StatusPill({
  tone,
  children,
}: {
  tone: PillTone;
  children: ReactNode;
}) {
  const t = TONE[tone];
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-pill border px-2 py-[3px] text-[11.5px] font-semibold " +
        t.pill
      }
    >
      <span
        aria-hidden
        className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full text-[9px] font-bold"
      >
        {t.glyph}
      </span>
      <span className="sr-only">{t.sr}: </span>
      {children}
    </span>
  );
}
