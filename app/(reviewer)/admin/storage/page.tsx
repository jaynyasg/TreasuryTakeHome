import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";
import { getReconciliation } from "@/lib/server/admin";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import { createVercelBlobStorage } from "@/lib/adapters/storage/vercelBlob";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import { resolveAdminPage } from "@/components/admin/adminPage";
import Forbidden403 from "@/components/admin/Forbidden403";
import OpsTabs from "@/components/admin/OpsTabs";
import ReconciliationTable from "@/components/admin/ReconciliationTable";

/**
 * Storage Reconciliation tab (plan "Storage consistency"). Cross-checks the DB
 * object manifest against the blob store and surfaces missing_blob /
 * orphaned_blob findings in a table, under a `summarizeReconciliation` health
 * banner. Repair/delete actions are stubbed as a clear manual note for this
 * prototype. Table-first; loading/empty/error/permission-denied states.
 */
export const dynamic = "force-dynamic";

/** Select the storage adapter for the active provider (mirrors the file route). */
function selectStorage(): StorageAdapter {
  return process.env.STORAGE_PROVIDER === "vercel-blob"
    ? createVercelBlobStorage()
    : createFakeStorage();
}

export default async function StoragePage() {
  const ctx = await resolveAdminPage();
  if (ctx.forbidden) return <Forbidden403 title="Storage Reconciliation" />;

  let body: React.ReactNode;
  try {
    const storage = selectStorage();
    const rows = await getReconciliation(ctx.principal, storage);
    body = <ReconciliationTable rows={rows} />;
  } catch {
    body = (
      <div
        role="alert"
        className="rounded-card border border-accent-red/40 bg-accent-red/10 p-4 text-[13px] text-ink"
      >
        Storage reconciliation is unavailable. Refresh to retry; if it persists,
        check the storage provider connection.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Storage Reconciliation"
        description="Detect drift between the DB object manifest and the blob store: manifest rows whose blob is missing, and blobs with no manifest row."
        counts={<Badge>Admin · Operations Console</Badge>}
      />
      <OpsTabs />
      {body}
    </div>
  );
}
