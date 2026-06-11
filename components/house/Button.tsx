import { type ButtonHTMLAttributes, type ReactNode } from "react";

// Primary dark CTA. Inset highlight + press-scale + dark focus ring.
// Optional leading icon gets a playful tilt-and-grow on hover (the "group"
// drives it) — the small delight that makes the button feel alive.
export default function Button({
  className = "",
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon?: ReactNode }) {
  return (
    <button
      className={
        "group inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-ink px-3 text-[13px] font-medium text-white " +
        "shadow-[0_1px_2px_0_rgb(16_17_26/0.06),inset_0_1px_0_0_rgb(255_255_255/0.1)] " +
        "transition hover:bg-[#2c2620] active:scale-[0.985] " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25 " +
        "disabled:pointer-events-none disabled:opacity-50 " +
        className
      }
      {...props}
    >
      {icon && (
        <span className="transition-transform duration-300 group-hover:rotate-[16deg] group-hover:scale-110">
          {icon}
        </span>
      )}
      {children}
    </button>
  );
}
