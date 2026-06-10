import Badge from "@/components/house/Badge";
import { VerdictStatus } from "@/lib/contract";

const STYLES: Record<VerdictStatus, { label: string; className: string }> = {
  match: { label: "Match", className: "border-accent-green/40 bg-accent-green/10 text-accent-green" },
  close_match: { label: "Match*", className: "border-accent-green/40 bg-accent-green/10 text-accent-green" },
  mismatch: { label: "Mismatch", className: "border-accent-red/40 bg-accent-red/10 text-accent-red" },
  missing_on_label: { label: "Missing", className: "border-accent-red/40 bg-accent-red/10 text-accent-red" },
  needs_review: { label: "Review", className: "border-accent-amber/50 bg-accent-amber/10 text-ink-2" },
  not_applicable: { label: "N/A", className: "text-muted-2" },
};

export default function StatusBadge({ status }: { status: VerdictStatus }) {
  const s = STYLES[status];
  return <Badge className={s.className}>{s.label}</Badge>;
}
