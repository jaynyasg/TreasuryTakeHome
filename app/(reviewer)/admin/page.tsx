import Link from "next/link";
import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";
import { getOpsHealth } from "@/lib/server/admin";
import { classifyOps, overallLevel, type HealthLevel } from "@/lib/view/admin";
import { resolveAdminPage } from "@/components/admin/adminPage";
import Forbidden403 from "@/components/admin/Forbidden403";
import OpsHealthStrip from "@/components/admin/OpsHealthStrip";
import OpsTabs from "@/components/admin/OpsTabs";
import StatusPill from "@/components/admin/StatusPill";

/**
 * Operations HEALTH landing — the admin default (plan: "admins land on
 * Operations Health"; Admin IA "Health" tab; Core UI State Table "Ops Console").
 *
 * Renders compact health TILES classified by `classifyOps` (ok/warn/alert, each
 * with a label + shape glyph, never color-only) plus quick links to the other
 * tabs. The tiles are summaries; the real operational work lives in the tab
 * tables (Anti-Generic UI Constraints). Surfaces the last-checked time so a stale
 * read is obvious, and an overall severity banner for the healthy / degraded
 * states.
 *
 * Guarded by `resolveAdminPage` (requireAdmin → 403 view). A DB/read failure
 * renders the error state with a refresh path rather than crashing.
 */
export const dynamic = "force-dynamic";

const BANNER: Record<HealthLevel, { tone: "ok" | "warn" | "alert"; text: string }> = {
  ok: { tone: "ok", text: "All operational signals are within thresholds." },
  warn: {
    tone: "warn",
    text: "One or more signals are elevated. Review the flagged tiles and tabs.",
  },
  alert: {
    tone: "alert",
    text: "One or more signals are in alert. Investigate dead-letters, worker heartbeat, and stuck jobs.",
  },
};

const QUICK_LINKS: ReadonlyArray<{ href: string; label: string; desc: string }> = [
  { href: "/admin/failed", label: "Failed jobs", desc: "Replay dead-letter cases" },
  { href: "/admin/assignments", label: "Assignments", desc: "Reassign batch ownership" },
  { href: "/admin/exports", label: "Exports", desc: "Generate point-in-time exports" },
  { href: "/admin/retention", label: "Retention", desc: "Preview + approve purge" },
  { href: "/admin/storage", label: "Storage", desc: "Reconcile missing/orphaned blobs" },
  { href: "/admin/settings", label: "Settings", desc: "Kill switches + feature flags" },
];

export default async function OperationsPage() {
  const ctx = await resolveAdminPage();
  if (ctx.forbidden) return <Forbidden403 title="Operations" />;

  const checkedAt = new Date();

  let body: React.ReactNode;
  try {
    const health = await getOpsHealth(ctx.principal);
    const classification = classifyOps(health, checkedAt.getTime());
    const overall = overallLevel(classification);
    const banner = BANNER[overall];
    body = (
      <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <StatusPill tone={banner.tone}>{banner.text}</StatusPill>
          <span className="text-[11.5px] text-muted-2">
            Last checked{" "}
            <time dateTime={checkedAt.toISOString()}>
              {checkedAt.toISOString().replace("T", " ").slice(0, 19)} UTC
            </time>
          </span>
        </div>
        <OpsHealthStrip classification={classification} />
        <section className="flex flex-col gap-2">
          <h2 className="text-[13px] font-semibold text-ink">Operations tabs</h2>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {QUICK_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="flex min-h-[44px] flex-col justify-center rounded-card border border-line bg-card px-3 py-2 transition hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <span className="text-[13px] font-medium text-ink">
                    {link.label}
                  </span>
                  <span className="text-[11.5px] text-muted">{link.desc}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </>
    );
  } catch {
    body = (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-card border border-accent-red/40 bg-accent-red/10 p-4 text-[13px] text-ink"
      >
        <span className="font-medium">Operations health is unavailable.</span>
        <span className="text-ink-2">
          The health read failed. Refresh to retry; if it persists, check the
          database / queue providers and the worker heartbeat.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Operations"
        description="System health, failed and dead-letter work, and recovery actions."
        counts={<Badge>Admin · Operations Console</Badge>}
      />
      <OpsTabs />
      {body}
    </div>
  );
}
