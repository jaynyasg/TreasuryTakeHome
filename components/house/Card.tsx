import { type ReactNode } from "react";

export default function Card({
  children,
  className = "",
  padded = true,
  bare = false,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
  bare?: boolean;
}) {
  return (
    <div
      className={
        "rounded-card border border-line bg-card " +
        (bare ? "" : "shadow-card ") +
        (padded ? "p-5 " : "") +
        className
      }
    >
      {children}
    </div>
  );
}
