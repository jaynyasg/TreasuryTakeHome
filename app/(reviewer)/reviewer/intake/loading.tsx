import PageHeader from "@/components/app-shell/PageHeader";
import Card from "@/components/house/Card";
import Badge from "@/components/house/Badge";

/**
 * Route-level loading state for Batch Intake (Stage 7 Wave 2; the Intake
 * "Loading" cell of the Core UI State Table: file-list skeleton, upload-area
 * placeholder, and a resumable-session label). Shown while the server component
 * resolves the principal before the client workspace hydrates.
 */
export default function IntakeLoading() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Start a Batch"
        description="Upload your application and label files, review what was found, then start processing."
      />

      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <Badge className="border-accent-blue/40 bg-accent-blue/10 text-accent-blue">
          Loading
        </Badge>
        <span>Checking for a draft you can resume…</span>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="space-y-5">
          <Card>
            <div className="h-[112px] animate-pulse rounded-card border-2 border-dashed border-line bg-surface/60" />
          </Card>
          <Card>
            <div className="mb-3 h-4 w-28 animate-pulse rounded bg-line" />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 animate-pulse rounded-lg border border-line-2 bg-surface/40"
                />
              ))}
            </div>
          </Card>
        </div>
        <div className="lg:sticky lg:top-5 lg:self-start">
          <Card>
            <div className="mb-3 h-4 w-40 animate-pulse rounded bg-line" />
            <div className="grid grid-cols-2 gap-2.5">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 animate-pulse rounded-lg border border-line-2 bg-surface/40"
                />
              ))}
            </div>
            <div className="mt-4 h-9 animate-pulse rounded-lg bg-line" />
          </Card>
        </div>
      </div>
    </div>
  );
}
