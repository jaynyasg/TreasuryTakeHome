import { Suspense } from "react";
import Link from "next/link";
import PageHeader from "@/components/app-shell/PageHeader";
import { requirePrincipal } from "@/lib/server/session";
import { getWorkQueue } from "@/lib/server/queries";
import type { Principal } from "@/lib/auth/authorize";
import type { QueueSeverity } from "@/lib/server/dto";
import { CASE_STATES, type CaseState } from "@/lib/core/state/case";
import PriorityCounters from "@/components/queue/PriorityCounters";
import QueueFilters from "@/components/queue/QueueFilters";
import TriageTable from "@/components/queue/TriageTable";
import QueueEmptyState from "@/components/queue/QueueEmptyState";
import QueueTableSkeleton from "@/components/queue/QueueTableSkeleton";
import { formatAbsoluteTime } from "@/components/queue/format";

/**
 * Work Queue — the reviewer's default landing screen (Stage 7 / T7, Wave 2).
 *
 * Server component. It (1) resolves the principal, (2) parses filter
 * searchParams through a fixed allow-list (never trusting raw query shape),
 * (3) reads `getWorkQueue` from the Wave 1 data layer, and (4) renders the
 * PageHeader + priority counters + sticky filters + the triage table — the table
 * being the main surface (Anti-Generic UI Constraints).
 *
 * The data read is isolated in `<QueueData>` behind `<Suspense>` so the header
 * and filter controls paint immediately while the query resolves; `loading.tsx`
 * covers the full-navigation case. Per the screen-hierarchy constraint, the
 * first three reviewer questions — priority counts, the case table, and the
 * assignment control — are visible without scrolling.
 */

export const dynamic = "force-dynamic";

/** Next 15 passes searchParams as a Promise to async server components. */
type SearchParams = Record<string, string | string[] | undefined>;

const CASE_STATE_SET: ReadonlySet<string> = new Set<CaseState>(CASE_STATES);

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

/** Parse-or-default: only accept known severity buckets, else "" (all). */
function parseSeverity(raw: string): "" | QueueSeverity {
  if (raw === "red" || raw === "amber" || raw === "green" || raw === "none") return raw;
  return "";
}

/** Parse-or-default: only accept a real CaseState, else "" (all). */
function parseStatus(raw: string): "" | CaseState {
  return CASE_STATE_SET.has(raw) ? (raw as CaseState) : "";
}

/** Reviewers are always scoped to their cases; only admins may pick "all". */
function parseAssignment(raw: string, principal: Principal): "mine" | "all" {
  if (principal.role !== "admin") return "mine";
  return raw === "all" ? "all" : "mine";
}

export default async function WorkQueuePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;

  const severity = parseSeverity(firstParam(params.severity));
  const status = parseStatus(firstParam(params.status));
  const assignment = parseAssignment(firstParam(params.assignment), principal);
  const cursor = firstParam(params.cursor) || undefined;
  const isAdmin = principal.role === "admin";
  const filtered = severity !== "" || status !== "" || (isAdmin && assignment === "all");

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Work Queue"
        description="Assigned cases, ordered red → amber → green. The machine verdict is advisory; your disposition is authoritative."
        actions={
          <Link
            href="/reviewer/intake"
            className="inline-flex min-h-[36px] items-center rounded-lg border border-line bg-card px-3 text-[12.5px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            New intake
          </Link>
        }
      />

      <QueueFilters
        severity={severity}
        status={status}
        assignment={assignment}
        isAdmin={isAdmin}
      />

      <Suspense
        // Re-suspend whenever the predicate changes so the skeleton shows while
        // the new filtered page resolves.
        key={`${severity}|${status}|${assignment}|${cursor ?? ""}`}
        fallback={<QueueTableSkeleton />}
      >
        <QueueData
          principal={principal}
          severity={severity}
          status={status}
          assignment={assignment}
          cursor={cursor}
          isAdmin={isAdmin}
          filtered={filtered}
        />
      </Suspense>
    </div>
  );
}

async function QueueData({
  principal,
  severity,
  status,
  assignment,
  cursor,
  isAdmin,
  filtered,
}: {
  principal: Principal;
  severity: "" | QueueSeverity;
  status: "" | CaseState;
  assignment: "mine" | "all";
  cursor: string | undefined;
  isAdmin: boolean;
  filtered: boolean;
}) {
  const result = await getWorkQueue(principal, {
    severity: severity || undefined,
    status: status || undefined,
    assignment,
    cursor,
  });

  // Captured once per render so the "last refreshed" cue is deterministic and
  // matches the data we just read.
  const refreshedAt = new Date().toISOString();

  if (result.rows.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <PriorityCounters counts={result.counts} />
        <QueueEmptyState isAdmin={isAdmin} filtered={filtered} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PriorityCounters counts={result.counts} />
      <TriageTable rows={result.rows} />
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11.5px] text-muted-2">
        <span>
          {result.rows.length} case{result.rows.length === 1 ? "" : "s"} shown
          {result.nextCursor ? " · more available" : ""}
        </span>
        <span title={formatAbsoluteTime(refreshedAt)}>
          Last refreshed {formatAbsoluteTime(refreshedAt)}
        </span>
      </div>
      {result.nextCursor && (
        <div className="flex justify-center">
          <Link
            href={`/reviewer/queue?${buildCursorQuery(severity, status, assignment, isAdmin, result.nextCursor)}`}
            scroll={false}
            className="inline-flex min-h-[40px] items-center rounded-lg border border-line bg-card px-4 text-[13px] font-medium text-ink-2 transition hover:border-accent/40 hover:bg-surface hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            Load next page
          </Link>
        </div>
      )}
    </div>
  );
}

/** Build the "load next page" href, preserving the active filter predicate. */
function buildCursorQuery(
  severity: "" | QueueSeverity,
  status: "" | CaseState,
  assignment: "mine" | "all",
  isAdmin: boolean,
  cursor: string
): string {
  const qs = new URLSearchParams();
  if (severity) qs.set("severity", severity);
  if (status) qs.set("status", status);
  if (isAdmin && assignment === "all") qs.set("assignment", "all");
  qs.set("cursor", cursor);
  return qs.toString();
}
