import PageHeader from "@/components/app-shell/PageHeader";
import { requirePrincipal } from "@/lib/server/session";
import IntakeWorkspace from "@/components/intake/IntakeWorkspace";

/**
 * Reviewer Batch Intake screen (Stage 7 Wave 2 — the UI for the Stage 5 intake
 * backend, plan T4 "Batch Intake Concierge").
 *
 * Server component: re-resolves the principal (the `(reviewer)` layout already
 * gated auth + the `DURABLE_BATCH` flag, but this keeps the screen safe in
 * isolation), renders the standard `PageHeader`, then hands off to the client
 * `IntakeWorkspace`, which drives the upload → preflight → start flow entirely
 * through client fetches to the existing intake API.
 */
export default async function IntakePage() {
  await requirePrincipal();

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Start a Batch"
        description="Upload your application and label files, review what was found, then start processing. Nothing runs until you press Start, and you can leave and come back — your files are kept."
      />
      <IntakeWorkspace />
    </div>
  );
}
