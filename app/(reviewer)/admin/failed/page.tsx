import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";
import { listDeadLetters } from "@/lib/server/admin";
import { resolveAdminPage } from "@/components/admin/adminPage";
import Forbidden403 from "@/components/admin/Forbidden403";
import OpsTabs from "@/components/admin/OpsTabs";
import DeadLetterTable from "@/components/admin/DeadLetterTable";

/**
 * Failed / Dead-letter Jobs tab (plan Admin IA). Table-first: the dead-letter
 * table carries the work, with a per-row guarded Replay action (reason required).
 * Loading/empty/error/permission-denied states per the Core UI State Table.
 */
export const dynamic = "force-dynamic";

export default async function FailedJobsPage() {
  const ctx = await resolveAdminPage();
  if (ctx.forbidden) return <Forbidden403 title="Failed jobs" />;

  let body: React.ReactNode;
  try {
    const rows = await listDeadLetters(ctx.principal);
    body =
      rows.length === 0 ? (
        <p className="rounded-card border border-line bg-card px-4 py-6 text-center text-[13px] text-muted">
          No dead-letter jobs. The processing line is clear.
        </p>
      ) : (
        <DeadLetterTable rows={rows} actor={ctx.actorLabel} />
      );
  } catch {
    body = (
      <div
        role="alert"
        className="rounded-card border border-accent-red/40 bg-accent-red/10 p-4 text-[13px] text-ink"
      >
        Dead-letter jobs are unavailable. Refresh to retry.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Failed / Dead-letter Jobs"
        description="Poison jobs parked after exhausting retries. Replay after repair — replay appends a new attempt and never overwrites prior evidence."
        counts={<Badge>Admin · Operations Console</Badge>}
      />
      <OpsTabs />
      {body}
    </div>
  );
}
