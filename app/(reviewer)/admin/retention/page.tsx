import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";
import { getRetentionPreview } from "@/lib/server/admin";
import { resolveAdminPage } from "@/components/admin/adminPage";
import { isPurgeKillSwitchOn } from "@/components/admin/killSwitches";
import Forbidden403 from "@/components/admin/Forbidden403";
import OpsTabs from "@/components/admin/OpsTabs";
import RetentionPreviewTable from "@/components/admin/RetentionPreviewTable";

/**
 * Retention tab (plan "Retention purge"). Two-phase flow: PREVIEW the purge-
 * eligible counts grouped by aggregate type, then APPROVE (reason required;
 * respects the purge kill switch). The result/tombstone summary renders after.
 * Table-first; loading/empty/error/permission-denied + disabled-by-kill-switch
 * states.
 */
export const dynamic = "force-dynamic";

export default async function RetentionPage() {
  const ctx = await resolveAdminPage();
  if (ctx.forbidden) return <Forbidden403 title="Retention" />;

  const killSwitchOn = isPurgeKillSwitchOn();

  let body: React.ReactNode;
  try {
    const preview = await getRetentionPreview(ctx.principal, new Date());
    body = (
      <RetentionPreviewTable
        preview={preview}
        killSwitchOn={killSwitchOn}
        actor={ctx.actorLabel}
      />
    );
  } catch {
    body = (
      <div
        role="alert"
        className="rounded-card border border-accent-red/40 bg-accent-red/10 p-4 text-[13px] text-ink"
      >
        The retention preview is unavailable. Refresh to retry.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Retention"
        description="Two-phase purge: review purge-eligible counts, then approve. Approving a purge requires a reason and writes a minimal tombstone for the deletion audit."
        counts={<Badge>Admin · Operations Console</Badge>}
      />
      <OpsTabs />
      {body}
    </div>
  );
}
