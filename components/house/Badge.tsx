import { type ReactNode } from "react";

// Compact pill label. Neutral by default; pass accent classes for semantic state.
export default function Badge({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={
        "inline-flex items-center rounded-pill border border-line bg-card px-2.5 py-[5px] text-[11.5px] font-medium text-ink-2 " +
        "transition hover:border-accent/40 hover:bg-surface " +
        className
      }
    >
      {children}
    </span>
  );
}
