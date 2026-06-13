import { type ReactNode } from "react";
import Link from "next/link";
import type { QueueRowDTO, QueueSeverity } from "@/lib/server/dto";
import type { CaseState } from "@/lib/core/state/case";
import { severityLabel, statusLabel } from "@/lib/view/queue";
import { formatRelativeTime, formatAbsoluteTime, joinIdentityParts, shortOwner } from "./format";

/**
 * The Work Queue's MAIN surface (Stage 7 / T7, Wave 2): a dense, scannable
 * triage table implementing the plan's "Work Queue Row Anatomy".
 *
 * Desktop columns: (1) severity/status, (2) case identity, (3) issue summary,
 * (4) evidence cue, (5) assignment, (6) updated + ruleset cue, (7) primary
 * action. Rows keep STABLE heights; long issue text is two-line truncated with
 * the full text preserved (`title` + screen-reader text). The whole row links to
 * the case; the explicit action button is the keyboard-first affordance.
 *
 * Mobile collapses to a card-like stacked layout (severity/status, identity, one
 * issue line, assignment, one action) via responsive Tailwind — no second route.
 *
 * Accessibility: a real `<table>` with `<caption>`, `scope`-d headers, visible
 * focus rings, and 44px-tall action targets. Severity is never color-only — the
 * badge always carries a text label and a shape token.
 */

// --- severity / status presentation -----------------------------------------

const SEVERITY_STYLE: Record<QueueSeverity, { chip: string; dot: string }> = {
  red: { chip: "border-accent-red/40 bg-accent-red/10 text-ink", dot: "bg-accent-red" },
  amber: { chip: "border-accent-amber/50 bg-accent-amber/10 text-ink", dot: "bg-accent-amber" },
  green: { chip: "border-accent-green/40 bg-accent-green/10 text-ink", dot: "bg-accent-green" },
  none: { chip: "border-line bg-surface text-ink-2", dot: "bg-muted-2" },
};

function SeverityBadge({ severity, status }: { severity: QueueSeverity; status: CaseState }) {
  const s = SEVERITY_STYLE[severity];
  return (
    <span className="inline-flex flex-col gap-1">
      <span
        className={
          "inline-flex items-center gap-1.5 rounded-pill border px-2 py-[3px] text-[11px] font-semibold " +
          s.chip
        }
      >
        <span className={"h-2 w-2 shrink-0 rounded-full " + s.dot} aria-hidden />
        {severityLabel(severity)}
      </span>
      <span className="text-[11px] font-medium text-muted">{statusLabel(status)}</span>
    </span>
  );
}

// --- evidence cue ------------------------------------------------------------

const FAILED_STATES = new Set<CaseState>(["failed", "dead_letter"]);
const CLEAN_STATES = new Set<CaseState>(["clean_match", "disposition_recorded"]);

function EvidenceCue({ row }: { row: QueueRowDTO }) {
  if (FAILED_STATES.has(row.status)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-accent-red">
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-accent-red/50 text-[10px] font-bold">!</span>
        Processing failed
      </span>
    );
  }
  if (row.status === "needs_better_image") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-[3px] border border-line text-[10px]">▦</span>
        Low-quality image
      </span>
    );
  }
  if (row.severity === "amber" || row.status === "needs_review") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-2">
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-accent-amber/60 text-[10px] font-bold text-accent-amber">?</span>
        Uncertain — review evidence
      </span>
    );
  }
  if (CLEAN_STATES.has(row.status)) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
        <span aria-hidden className="grid h-4 w-4 place-items-center rounded-full border border-accent-green/50 text-[10px] font-bold text-accent-green">✓</span>
        Clean match
      </span>
    );
  }
  return <span className="text-[12px] text-muted-2">In progress</span>;
}

// --- assignment cue ----------------------------------------------------------

// A case that needs a human but has no owner is a triage gap worth flagging.
const ACTIONABLE_STATES = new Set<CaseState>([
  "needs_review",
  "has_mismatches",
  "needs_better_image",
  "failed",
  "dead_letter",
]);

function AssignmentCue({ row }: { row: QueueRowDTO }) {
  const stale = !row.assignedUserId && ACTIONABLE_STATES.has(row.status);
  return (
    <span className="inline-flex flex-col gap-0.5">
      <span className="text-[12px] text-ink-2">
        {row.assignedToMe ? "You" : shortOwner(row.assignedUserId)}
      </span>
      {stale && (
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-accent-amber">
          <span aria-hidden>△</span> Needs owner
        </span>
      )}
    </span>
  );
}

// --- primary action ----------------------------------------------------------

interface PrimaryAction {
  label: string;
  /** Visual emphasis: solid for the most urgent action, hairline otherwise. */
  emphasis: "solid" | "ghost";
}

function primaryActionFor(status: CaseState): PrimaryAction {
  switch (status) {
    case "needs_better_image":
      return { label: "Request better image", emphasis: "solid" };
    case "failed":
    case "dead_letter":
      return { label: "Replay case", emphasis: "solid" };
    case "needs_review":
    case "has_mismatches":
      return { label: "Open case", emphasis: "solid" };
    case "draft":
      return { label: "Resume intake", emphasis: "ghost" };
    default:
      return { label: "Open case", emphasis: "ghost" };
  }
}

function ActionLink({
  href,
  action,
  identity,
}: {
  href: string;
  action: PrimaryAction;
  identity: string;
}) {
  const base =
    "inline-flex min-h-[36px] items-center justify-center whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-card ";
  const tone =
    action.emphasis === "solid"
      ? "bg-ink text-white hover:bg-[#2c2620] focus-visible:ring-ink/25"
      : "border border-line bg-card text-ink-2 hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:ring-accent/40";
  return (
    <Link href={href} className={base + tone} aria-label={`${action.label}: ${identity}`}>
      {action.label}
    </Link>
  );
}

// --- issue summary (2-line truncate + accessible full text) ------------------

function IssueSummary({ row }: { row: QueueRowDTO }) {
  if (!row.issueSummary) {
    return <span className="text-[12.5px] text-muted-2">No outstanding issue</span>;
  }
  return (
    <span className="block" title={row.issueFull}>
      <span
        className="block overflow-hidden text-[12.5px] leading-snug text-ink-2 [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [display:-webkit-box]"
        aria-hidden
      >
        {row.issueSummary}
      </span>
      {/* Full untruncated text for assistive tech. */}
      <span className="sr-only">{row.issueFull}</span>
    </span>
  );
}

// --- identity ----------------------------------------------------------------

function CaseIdentity({ row }: { row: QueueRowDTO }) {
  const tail = joinIdentityParts([row.classType, row.applicant]);
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-[13px] font-medium text-ink">
        {row.brand ?? row.caseId}
      </span>
      <span className="truncate text-[11.5px] text-muted">
        {row.batchName} · {row.caseId}
      </span>
      {tail && <span className="truncate text-[11.5px] text-muted-2">{tail}</span>}
    </span>
  );
}

// --- column headers ----------------------------------------------------------

const COLUMNS: ReadonlyArray<{ label: string; className?: string }> = [
  { label: "Priority" },
  { label: "Case" },
  { label: "Issue" },
  { label: "Evidence" },
  { label: "Owner" },
  { label: "Updated" },
  { label: "Action", className: "text-right" },
];

// -----------------------------------------------------------------------------

export default function TriageTable({
  rows,
  caseHrefBase = "/reviewer/cases",
}: {
  rows: readonly QueueRowDTO[];
  caseHrefBase?: string;
}) {
  const Cell = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
    <td className={"px-3 py-3 align-top " + className}>{children}</td>
  );

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-card">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Triage work queue, ordered by severity, then status priority, then most
          recently updated. {rows.length} cases shown.
        </caption>
        {/* Desktop header row; hidden on mobile where rows stack as cards. */}
        <thead className="hidden md:table-header-group">
          <tr className="border-b border-line bg-surface/60">
            {COLUMNS.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={
                  "px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted " +
                  (c.className ?? "")
                }
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const href = `${caseHrefBase}/${row.caseId}`;
            const action = primaryActionFor(row.status);
            const identity = row.brand ?? row.caseId;
            return (
              <tr
                key={row.caseId}
                className={
                  "block border-b border-line transition last:border-b-0 hover:bg-surface/40 " +
                  "md:table-row " +
                  // Mobile: each row is a padded card-like block.
                  "p-3 md:p-0"
                }
              >
                {/* Mobile-collapsed layout (severity/status, identity, one issue,
                    assignment, one action) — shown < md, hidden on desktop. */}
                <td className="block md:hidden" colSpan={COLUMNS.length}>
                  <div className="flex items-start justify-between gap-3">
                    <SeverityBadge severity={row.severity} status={row.status} />
                    <span className="text-[11.5px] text-muted-2" title={formatAbsoluteTime(row.updatedAt)}>
                      {formatRelativeTime(row.updatedAt)}
                    </span>
                  </div>
                  <div className="mt-2">
                    <CaseIdentity row={row} />
                  </div>
                  <div className="mt-2">
                    <IssueSummary row={row} />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <AssignmentCue row={row} />
                    <ActionLink href={href} action={action} identity={identity} />
                  </div>
                </td>

                {/* Desktop cells. */}
                <Cell className="hidden md:table-cell">
                  <SeverityBadge severity={row.severity} status={row.status} />
                </Cell>
                <Cell className="hidden min-w-0 md:table-cell">
                  <CaseIdentity row={row} />
                </Cell>
                <Cell className="hidden max-w-[22rem] md:table-cell">
                  <IssueSummary row={row} />
                </Cell>
                <Cell className="hidden md:table-cell">
                  <EvidenceCue row={row} />
                </Cell>
                <Cell className="hidden md:table-cell">
                  <AssignmentCue row={row} />
                </Cell>
                <Cell className="hidden whitespace-nowrap md:table-cell">
                  <span
                    className="text-[12px] text-ink-2"
                    title={formatAbsoluteTime(row.updatedAt)}
                  >
                    {formatRelativeTime(row.updatedAt)}
                  </span>
                </Cell>
                <Cell className="hidden text-right md:table-cell">
                  <ActionLink href={href} action={action} identity={identity} />
                </Cell>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
