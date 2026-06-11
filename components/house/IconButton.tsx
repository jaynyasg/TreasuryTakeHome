import { type ButtonHTMLAttributes, type ReactNode } from "react";

// Icon + label button with the full state set from the source UI:
//  - primary: ink fill, inset top-highlight, dark focus ring
//  - secondary: hairline-bordered card, hover lifts to surface + accent edge
// Both press-scale on active and fade when disabled. The leading icon carries a
// hover micro-motion: "tilt" (flat rotate + grow, e.g. a spark) or "spin3d"
// (a perspective tumble, e.g. a solid). Pass `loading` to swap in a spinner.
type Variant = "primary" | "secondary";
type IconMotion = "tilt" | "spin3d";

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-ink text-white shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] " +
    "hover:bg-[#2c2620] focus-visible:ring-ink/25 disabled:opacity-60",
  secondary:
    "border border-line bg-card text-ink-2 hover:border-accent/40 hover:bg-surface hover:text-ink " +
    "focus-visible:ring-accent/40 disabled:text-muted-2 disabled:opacity-60",
};

const ICON_MOTION: Record<IconMotion, string> = {
  tilt: "group-hover:rotate-[16deg] group-hover:scale-110",
  spin3d: "group-hover:[transform:rotateX(20deg)_rotateY(-26deg)_scale(1.1)]",
};

export default function IconButton({
  icon,
  children,
  variant = "primary",
  iconMotion = "tilt",
  loading = false,
  className = "",
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: ReactNode;
  variant?: Variant;
  iconMotion?: IconMotion;
  loading?: boolean;
}) {
  return (
    <button
      disabled={disabled || loading}
      className={
        "group inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 " +
        "text-[13px] font-medium outline-none transition active:scale-[0.985] " +
        "focus-visible:ring-2 disabled:cursor-not-allowed disabled:active:scale-100 " +
        VARIANT[variant] +
        " " +
        className
      }
      {...props}
    >
      <span className={"transition-transform duration-300 " + ICON_MOTION[iconMotion]}>
        {loading ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden className="animate-spin">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        ) : (
          icon
        )}
      </span>
      {children}
    </button>
  );
}
