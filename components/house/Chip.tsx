import { type ButtonHTMLAttributes, type ReactNode } from "react";

// The example/seed chip: a pill that lifts on hover (-translate-y-px + shadow)
// and presses in on click (scale-95). Two tones:
//  - "neutral": hairline pill, hover gains an accent edge + surface fill
//  - "highlight": amber-tinted to flag a special/ready item, with a leading dot
// `dot` adds a small status dot (auto-on for highlight). Disabled freezes the
// lift/press and dims — the same restraint the source uses while busy.
type Tone = "neutral" | "highlight";

const TONE: Record<Tone, string> = {
  neutral:
    "border-line bg-card text-ink-2 hover:border-accent/40 hover:bg-surface hover:text-ink " +
    "disabled:hover:border-line disabled:hover:bg-card disabled:hover:text-ink-2",
  highlight:
    "border-accent-amber/50 bg-accent-amber/10 text-ink-2 hover:border-accent-amber hover:bg-accent-amber/20 hover:text-ink " +
    "disabled:hover:border-accent-amber/50 disabled:hover:bg-accent-amber/10 disabled:hover:text-ink-2",
};

export default function Chip({
  children,
  tone = "neutral",
  dot,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  const showDot = dot ?? tone === "highlight";
  return (
    <button
      type="button"
      className={
        "inline-flex items-center rounded-pill border px-2.5 py-[5px] text-[11.5px] font-medium " +
        "transition-all hover:-translate-y-px hover:shadow-card active:scale-95 " +
        "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none " +
        TONE[tone] +
        " " +
        className
      }
      {...props}
    >
      {showDot && (
        <span
          className={
            "mr-1.5 h-1.5 w-1.5 rounded-full " +
            (tone === "highlight" ? "bg-accent-amber" : "bg-accent")
          }
          aria-hidden
        />
      )}
      {children}
    </button>
  );
}
