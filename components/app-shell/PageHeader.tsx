import { type ReactNode } from "react";

/**
 * Standard header for every primary reviewer/admin screen (Stage 7 / T7).
 *
 * Title + optional description, with a counts strip and an actions slot. The
 * screen-hierarchy constraint requires each primary screen to make its first
 * three reviewer/admin questions visible without scrolling — this header is the
 * top of that fold (e.g. Work Queue: priority counts + assignment action here,
 * the case table immediately below).
 *
 * Utility copy only (status / evidence / action) — no aspirational product copy.
 */
export default function PageHeader({
  title,
  description,
  counts,
  actions,
}: {
  title: string;
  description?: string;
  /** Compact priority counters or status chips shown beside the title. */
  counts?: ReactNode;
  /** Primary action controls (buttons), right-aligned on wide viewports. */
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-line pb-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight text-ink">
            {title}
          </h1>
          {description && (
            <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        )}
      </div>
      {counts && (
        <div className="flex flex-wrap items-center gap-1.5">{counts}</div>
      )}
    </header>
  );
}
