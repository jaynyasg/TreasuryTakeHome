import Card from "@/components/house/Card";
import Badge from "@/components/house/Badge";
import DispositionControls from "@/components/case/DispositionControls";
import { hasOverridableConcern } from "@/components/case/dispositionRules";
import type {
  CaseDetailView,
  RecordDispositionAction,
} from "@/components/case/types";

/**
 * Decision-first header for Case Detail (plan "Case detail IA": machine overall
 * verdict + match %, the required human action, disposition controls, and key
 * reasons at the very top — visible without scrolling).
 *
 * Trust framing (plan "Journey" step 5 / D3 trust cues): the machine verdict is
 * explicitly labeled ADVISORY; the human disposition is explicitly labeled
 * AUTHORITATIVE. This is the single most important copy distinction on the
 * screen, so it is stated in words, not just layout.
 */

interface OverallStyle {
  text: string;
  className: string;
  wash: string;
  /** The required human action implied by this verdict. */
  action: string;
}

const OVERALL: Record<string, OverallStyle> = {
  all_match: {
    text: "All fields match",
    className: "text-accent-green",
    wash: "border-accent-green/30 bg-accent-green/5",
    action: "Confirm and approve, or flag a concern the machine missed.",
  },
  needs_review: {
    text: "Review needed",
    className: "text-ink-2",
    wash: "border-accent-amber/40 bg-accent-amber/10",
    action: "Resolve the uncertain items — approve, reject, or request a better image.",
  },
  has_mismatches: {
    text: "Issues found",
    className: "text-accent-red",
    wash: "border-accent-red/30 bg-accent-red/5",
    action: "Review the mismatches below, then reject or approve with a note.",
  },
};

/** Severity label + glyph (never color-only) for the case severity bucket. */
const SEVERITY: Record<string, { label: string; glyph: string; className: string }> = {
  red: { label: "High severity", glyph: "▲", className: "border-accent-red/40 bg-accent-red/10 text-accent-red" },
  amber: { label: "Medium severity", glyph: "●", className: "border-accent-amber/50 bg-accent-amber/10 text-ink-2" },
  green: { label: "Low severity", glyph: "■", className: "border-accent-green/40 bg-accent-green/10 text-accent-green" },
  none: { label: "No severity yet", glyph: "·", className: "text-muted" },
};

export default function DecisionHeader({
  view,
  actorUserId,
  evidenceLoaded,
  onRecord,
}: {
  view: CaseDetailView;
  actorUserId: string;
  evidenceLoaded: boolean;
  onRecord: RecordDispositionAction;
}) {
  const overall = view.machine?.overall ?? null;
  const overallStyle = overall ? OVERALL[overall] : null;
  const pct = view.machine?.matchPercentage ?? null;
  const sev = SEVERITY[view.dto.severity] ?? SEVERITY.none;
  const concern = hasOverridableConcern(view);

  return (
    <Card className="flex flex-col gap-4">
      {/* Advisory verdict + match % */}
      <div
        className={
          "flex flex-wrap items-end justify-between gap-4 rounded-lg border px-4 py-3 " +
          (overallStyle?.wash ?? "border-line-2 bg-surface")
        }
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
              Machine verdict
            </span>
            <Badge className="border-line bg-card text-[10.5px] uppercase tracking-[0.06em] text-muted">
              Advisory
            </Badge>
          </div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="text-4xl font-semibold tracking-tight text-ink">
              {pct === null ? "—" : `${pct}%`}
            </span>
            <span className={"text-[13px] font-medium " + (overallStyle?.className ?? "text-muted")}>
              {overallStyle?.text ?? "Not scored yet"}
            </span>
          </div>
          {view.machine?.summary && (
            <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed text-ink-2">
              {view.machine.summary}
            </p>
          )}
        </div>
        <Badge className={sev.className}>
          <span aria-hidden className="mr-1">
            {sev.glyph}
          </span>
          {sev.label}
        </Badge>
      </div>

      {/* Required human action */}
      <div className="rounded-lg border border-line-2 bg-surface px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Required action
          </span>
          <Badge className="border-accent/30 bg-accent/5 text-[10.5px] uppercase tracking-[0.06em] text-accent">
            Authoritative
          </Badge>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-ink">
          {overallStyle?.action ??
            "Record the human disposition once the case has been scored."}
        </p>
        {concern && (
          <p className="mt-1 text-[12px] text-muted">
            Approving over the flagged concern requires a written note.
          </p>
        )}
      </div>

      {/* Disposition action group */}
      <DispositionControls
        view={view}
        actorUserId={actorUserId}
        evidenceLoaded={evidenceLoaded}
        onRecord={onRecord}
      />

      {/* Identity strip */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-[12px] text-muted">
        <span>
          Case <span className="font-mono text-ink-2">{view.dto.caseId}</span>
        </span>
        <span>
          Batch <span className="text-ink-2">{view.dto.batchName}</span>
        </span>
        {view.dto.brand && (
          <span>
            Brand <span className="text-ink-2">{view.dto.brand}</span>
          </span>
        )}
        {view.dto.classType && (
          <span>
            Class <span className="text-ink-2">{view.dto.classType}</span>
          </span>
        )}
        {view.dto.applicant && (
          <span>
            Applicant <span className="text-ink-2">{view.dto.applicant}</span>
          </span>
        )}
      </div>
    </Card>
  );
}
