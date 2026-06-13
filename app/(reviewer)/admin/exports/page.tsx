import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";
import { listExports } from "@/lib/server/admin";
import { resolveAdminPage } from "@/components/admin/adminPage";
import Forbidden403 from "@/components/admin/Forbidden403";
import OpsTabs from "@/components/admin/OpsTabs";
import ExportsTable from "@/components/admin/ExportsTable";

/**
 * Exports tab (plan Admin IA). Lists point-in-time export snapshots (status,
 * created time, requester, artifact reference) with a "Generate export" action
 * by batch id. Table-first; loading/empty/error/permission-denied states.
 */
export const dynamic = "force-dynamic";

export default async function ExportsPage() {
  const ctx = await resolveAdminPage();
  if (ctx.forbidden) return <Forbidden403 title="Exports" />;

  let body: React.ReactNode;
  try {
    const rows = await listExports(ctx.principal);
    body = <ExportsTable rows={rows} actor={ctx.actorLabel} />;
  } catch {
    body = (
      <div
        role="alert"
        className="rounded-card border border-accent-red/40 bg-accent-red/10 p-4 text-[13px] text-ink"
      >
        Exports are unavailable. Refresh to retry.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Exports"
        description="Point-in-time export snapshots. Each export includes every case in the batch (clean, mismatch, failed, and still-processing) and is labeled complete or partial."
        counts={<Badge>Admin · Operations Console</Badge>}
      />
      <OpsTabs />
      {body}
    </div>
  );
}
