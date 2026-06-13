import PageHeader from "./PageHeader";
import Badge from "@/components/house/Badge";

/**
 * Obvious Wave-1 placeholder for a not-yet-built reviewer/admin screen.
 *
 * Used so every RoleNav link resolves (no 404s while navigating the shell) and
 * `next build` compiles all routes. Wave 2 / Stage 8 replace each of these with
 * the real screen. Kept deliberately plain so it never reads as finished work.
 */
export default function PlaceholderScreen({
  title,
  description,
  wave = "Wave 2",
}: {
  title: string;
  description: string;
  wave?: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        description={description}
        counts={<Badge>Placeholder — {wave}</Badge>}
      />
      <p className="text-[13px] text-muted">{title} (not yet built)…</p>
    </div>
  );
}
