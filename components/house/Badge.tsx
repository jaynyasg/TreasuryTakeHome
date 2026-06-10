import { type ReactNode } from "react";

// Compact pill label. Neutral by default; pass accent classes for semantic state.
// A Badge is a static label, never interactive — no hover affordance (use Chip
// when the pill is clickable).
export default function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-pill border border-line bg-card px-2.5 py-[5px] text-[11.5px] font-medium text-ink-2 " +
        className
      }
    >
      {children}
    </span>
  );
}
