import { type ReactNode } from "react";

// Centered overlay: darkened + blurred backdrop, pop-in content with strong depth.
export default function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 grid animate-fadeIn place-items-center bg-ink/70 p-8 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex animate-popIn flex-col gap-3 rounded-card border border-white/10 bg-surface p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
