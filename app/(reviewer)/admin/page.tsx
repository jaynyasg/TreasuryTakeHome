import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";

/**
 * Operations console (admin landing) — Wave 1 PLACEHOLDER.
 *
 * Admins land here (plan: "admins land on Operations Health"). Stage 8 (T8)
 * fills in the health strip, dead-letter table, kill switches, etc. For now this
 * resolves the admin landing route so role-based redirect + nav work.
 */
export default function OperationsPage() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Operations"
        description="System health, failed and dead-letter work, and recovery actions. Stage 8 builds the operational tables here."
        counts={<Badge>Placeholder — Stage 8</Badge>}
      />
      <p className="text-[13px] text-muted">Operations Health (loading)…</p>
    </div>
  );
}
