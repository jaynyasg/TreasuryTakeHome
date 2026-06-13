import { type ReactNode } from "react";
import type { QueueCounts } from "@/lib/server/dto";

/**
 * Compact priority counters shown ABOVE the triage table (Stage 7 / T7, Wave 2).
 *
 * These are summaries, not the main surface — the table below carries the work
 * (Anti-Generic UI Constraints: "priority counters may sit above it, but the
 * case rows are the main surface"). Per the Responsive/Accessibility spec,
 * severity is NEVER conveyed by color alone: every counter pairs its tint with a
 * text label and a small shape token, and the group is wrapped in a polite live
 * region so count changes are announced without stealing focus.
 */

interface CounterSpec {
  key: keyof QueueCounts;
  label: string;
  /** Tailwind classes for the small shape token (color is a redundant cue only). */
  dot: string;
  /** Border tint for the chip so red/amber/green read at a glance. */
  ring: string;
}

const SEVERITY_COUNTERS: CounterSpec[] = [
  { key: "red", label: "Red", dot: "bg-accent-red", ring: "border-accent-red/40" },
  { key: "amber", label: "Amber", dot: "bg-accent-amber", ring: "border-accent-amber/40" },
  { key: "green", label: "Green", dot: "bg-accent-green", ring: "border-accent-green/40" },
];

function Counter({
  label,
  value,
  dot,
  ring,
  icon,
}: {
  label: string;
  value: number;
  dot?: string;
  ring?: string;
  icon?: ReactNode;
}) {
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-pill border bg-card px-2.5 py-[5px] text-[11.5px] font-medium text-ink-2 " +
        (ring ?? "border-line")
      }
    >
      {dot ? (
        <span className={"h-2 w-2 shrink-0 rounded-full " + dot} aria-hidden />
      ) : (
        icon
      )}
      <span className="text-muted">{label}</span>
      <span className="tabular-nums font-semibold text-ink">{value}</span>
    </span>
  );
}

export default function PriorityCounters({ counts }: { counts: QueueCounts }) {
  const total = counts.red + counts.amber + counts.green;
  return (
    <div
      className="flex flex-wrap items-center gap-1.5"
      role="status"
      aria-live="polite"
      aria-label={`Priority counts: ${counts.red} red, ${counts.amber} amber, ${counts.green} green, ${counts.needsAction} needs action, ${counts.failed} failed`}
    >
      {SEVERITY_COUNTERS.map((c) => (
        <Counter
          key={c.key}
          label={c.label}
          value={counts[c.key]}
          dot={c.dot}
          ring={c.ring}
        />
      ))}
      <span className="mx-0.5 h-4 w-px bg-line" aria-hidden />
      <Counter
        label="Needs action"
        value={counts.needsAction}
        ring="border-line"
        icon={
          <span
            className="h-2 w-2 shrink-0 rotate-45 rounded-[1px] border border-ink-2"
            aria-hidden
          />
        }
      />
      <Counter
        label="Failed"
        value={counts.failed}
        ring="border-line"
        icon={
          <span
            className="grid h-3 w-3 shrink-0 place-items-center text-[9px] font-bold leading-none text-accent-red"
            aria-hidden
          >
            ✕
          </span>
        }
      />
      <span className="ml-auto text-[11.5px] text-muted-2 tabular-nums">
        {total} scored
      </span>
    </div>
  );
}
