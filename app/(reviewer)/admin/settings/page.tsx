import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";
import { resolveAdminPage } from "@/components/admin/adminPage";
import { readKillSwitches } from "@/components/admin/killSwitches";
import Forbidden403 from "@/components/admin/Forbidden403";
import OpsTabs from "@/components/admin/OpsTabs";
import KillSwitchPanel from "@/components/admin/KillSwitchPanel";

/**
 * Settings / Kill Switches tab (plan Admin IA + "Operational brakes"). Shows the
 * runtime kill-switch + feature-flag states as READ-ONLY indicators sourced from
 * env (`readKillSwitches`). Toggling is via env/ops, NOT in-app for this
 * prototype — stated explicitly below the table. Permission-denied state via the
 * 403 view.
 */
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const ctx = await resolveAdminPage();
  if (ctx.forbidden) return <Forbidden403 title="Settings" />;

  const switches = readKillSwitches();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Settings / Kill Switches"
        description="Runtime kill switches and feature flags for the durable batch system, read-only in this prototype."
        counts={<Badge>Admin · Operations Console</Badge>}
      />
      <OpsTabs />
      <KillSwitchPanel switches={switches} />
      <p className="max-w-2xl text-[12.5px] text-muted">
        These controls are sourced from environment variables and are read-only
        in-app for this prototype. To engage or clear a switch, set the named env
        var in the deployment / ops environment and redeploy — there is
        intentionally no in-app toggle, so an accidental click can never pause the
        line or block a purge. The purge kill switch is enforced server-side:
        when engaged, approving a retention purge deletes nothing.
      </p>
    </div>
  );
}
