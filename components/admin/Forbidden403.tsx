import PageHeader from "@/components/app-shell/PageHeader";
import Badge from "@/components/house/Badge";

/**
 * 403 / permission-denied view for the admin Operations Console (plan Core UI
 * State Table: every admin screen defines a permission-denied state).
 *
 * Rendered when `requireAdmin` throws `NotAuthorizedError` for a non-admin
 * principal who somehow reached an admin route. Utility copy only — states the
 * fact and the recovery path (return to the Work Queue) without leaking why.
 */
export default function Forbidden403({
  title = "Operations",
}: {
  title?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        description="The Operations Console is admin-only."
        counts={<Badge className="border-accent-red/40 text-ink">403 — Forbidden</Badge>}
      />
      <p className="text-[13px] text-muted">
        Your account does not have admin access to this area. Return to the{" "}
        <a
          href="/reviewer/queue"
          className="font-medium text-ink underline underline-offset-2 hover:text-accent"
        >
          Work Queue
        </a>
        .
      </p>
    </div>
  );
}
