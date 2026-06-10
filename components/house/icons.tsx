// Inline SVG icon set, faithfully ported from the source UI. Pure craft, no
// dependency. Each takes currentColor so it inherits text color; size via the
// width/height props. Use anywhere an icon + label pattern needs a crisp mark.
import { type SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, p: IconProps) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  "aria-hidden": true,
  ...p,
});

export function Sparkles({ size = 12, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none">
      <path
        d="M12 3l1.6 4.6L18 9l-4.4 1.4L12 15l-1.6-4.6L6 9l4.4-1.4L12 3zm7 9l.9 2.4L22 15l-2.1.6L19 18l-.9-2.4L16 15l2.1-.6L19 12z"
        fill="currentColor"
      />
    </svg>
  );
}

export function Spinner({ size = 12, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none" className={"animate-spin " + (p.className ?? "")}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export function Image({ size = 11, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none">
      <rect x="3" y="5" width="18" height="14" rx="3" stroke="currentColor" strokeWidth="2" />
      <circle cx="9" cy="11" r="1.6" fill="currentColor" />
      <path d="M5 17l5-4 4 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Cube({ size = 12, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none">
      <path
        d="M12 3l8 4.5v9L12 21 4 16.5v-9L12 3zM12 13l-6-3.5M12 13l6-3.5M12 13v8"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Bolt({ size = 11, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="currentColor">
      <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
    </svg>
  );
}

export function Diamond({ size = 10, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="currentColor">
      <path d="M12 2l10 10-10 10L2 12z" />
    </svg>
  );
}

export function Expand({ size = 10, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none">
      <path
        d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDown({ size = 13, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none">
      <path
        d="M6 9l6 6 6-6"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function X({ size = 11, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

// The draw-in checkmark: stroke "writes itself" via the drawIn keyframe.
export function Check({ size = 12, ...p }: IconProps) {
  return (
    <svg {...base(size, p)} fill="none">
      <path
        d="M5 12.5l4.5 4.5L19 7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={1}
        style={{ strokeDasharray: 1 }}
        className="animate-drawIn"
      />
    </svg>
  );
}
