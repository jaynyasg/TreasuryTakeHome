import { notFound } from "next/navigation";
import PageHeader from "@/components/app-shell/PageHeader";
import Card from "@/components/house/Card";
import { requirePrincipal } from "@/lib/server/session";
import {
  getCaseDetail,
  NotAuthorizedError,
  NotFoundError,
} from "@/lib/server/queries";
import type { CaseDetailDTO } from "@/lib/server/dto";
import DecisionHeader from "@/components/case/DecisionHeader";
import FieldComparisonTable from "@/components/case/FieldComparisonTable";
import WarningEvidence from "@/components/case/WarningEvidence";
import EvidenceTimeline from "@/components/case/EvidenceTimeline";
import DispositionControls from "@/components/case/DispositionControls";
import type { CaseDetailView } from "@/components/case/types";
import { recordDispositionAction } from "./actions";

/**
 * Reviewer Case Detail — decision-first screen (Stage 7 / T7, Wave 2; plan
 * "Case detail IA"). Async server component:
 *   1. resolve the principal (the group layout also requires one),
 *   2. read the case via `getCaseDetail(principal, id)`, mapping
 *      NotAuthorizedError -> 403 view and NotFoundError -> 404 (`notFound()`),
 *   3. render decision-first:
 *        (a) DECISION HEADER — machine advisory verdict + match %, required
 *            human action, disposition controls, key reasons,
 *        (b) FIELD COMPARISON — application vs. label, per-field,
 *        (c) WARNING EVIDENCE — crop + plain-language explanation,
 *        (d) TIMELINE + source files + retry/export history.
 *      The first three questions (verdict, comparison, warning) sit at the top
 *      of the fold; the sticky disposition group repeats after the evidence.
 *
 * DTO GAP: Wave 1's `CaseDetailDTO` carries only case identity + machine status.
 * It does NOT yet include the machine match %, field comparison, warning
 * evidence, timeline/attempts, source files, or disposition history. Until the
 * query layer is extended, those evidence slices are absent and each section
 * renders its graceful "not captured yet" state. The missing fields are listed
 * in the build report for the orchestrator to add to `getCaseDetail`.
 */
export default async function CaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const principal = await requirePrincipal();

  let dto: CaseDetailDTO;
  try {
    dto = await getCaseDetail(principal, id);
  } catch (err) {
    if (err instanceof NotFoundError) {
      notFound();
    }
    if (err instanceof NotAuthorizedError) {
      return <ForbiddenView caseId={id} />;
    }
    // Unexpected read failure: a recoverable case-level error class with a
    // retry/admin-replay path (plan "Case Detail" error state).
    return <CaseErrorView caseId={id} />;
  }

  // Compose the decision-first view from the now-richer DTO. Each evidence slice
  // maps 1:1 from the DTO; when the query layer did not populate a slice (no
  // verdict yet, no warning evidence, etc.) it falls through to the
  // status-derived advisory verdict / undefined, and the components degrade
  // gracefully.
  const view: CaseDetailView = {
    dto,
    // Prefer the real machine verdict (overall + match % + summary) when the
    // query layer surfaced one; otherwise derive a coarse "overall" from the
    // case status so the advisory label is still meaningful.
    machine: dto.machine ?? deriveMachine(dto),
    fields: dto.fields,
    warning: dto.warning ?? undefined,
    timeline: dto.timeline,
    sourceFiles: dto.sourceFiles,
    disposition: dto.disposition ?? undefined,
    stale: false,
  };

  // Evidence is "loaded" when the case has reached a state past scoring. Approve
  // is gated on this so a reviewer cannot approve before evidence exists.
  const evidenceLoaded = isEvidenceLoaded(dto);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Case detail"
        description="Decision-first review: the machine verdict is advisory; your disposition is authoritative."
      />

      {/* (a) Decision header — first question, no scroll */}
      <DecisionHeader
        view={view}
        actorUserId={principal.userId}
        evidenceLoaded={evidenceLoaded}
        onRecord={recordDispositionAction}
      />

      {/* (b) Field comparison — second question */}
      <FieldComparisonTable fields={view.fields} />

      {/* (c) Warning evidence — third question */}
      <WarningEvidence warning={view.warning} />

      {/* (d) Timeline + source files + history */}
      <EvidenceTimeline timeline={view.timeline} sourceFiles={view.sourceFiles} />

      {/* Sticky-repeat the disposition group after the long evidence sections */}
      <DispositionControls
        view={view}
        actorUserId={principal.userId}
        evidenceLoaded={evidenceLoaded}
        onRecord={recordDispositionAction}
        sticky
      />
    </div>
  );
}

/** Map case status to a coarse advisory verdict for the header. Mirrors the
 *  public `overall` vocabulary; null when the case is not yet scored. */
function deriveMachine(dto: CaseDetailDTO): CaseDetailView["machine"] {
  let overall: "all_match" | "needs_review" | "has_mismatches" | null = null;
  switch (dto.status) {
    case "clean_match":
      overall = "all_match";
      break;
    case "has_mismatches":
      overall = "has_mismatches";
      break;
    case "needs_review":
    case "needs_better_image":
      overall = "needs_review";
      break;
    default:
      overall = null;
  }
  return { overall, matchPercentage: null, summary: null };
}

/** True once the case has progressed to (or past) a scored/review state, so the
 *  evidence the reviewer needs to approve exists. */
function isEvidenceLoaded(dto: CaseDetailDTO): boolean {
  return (
    dto.status === "needs_review" ||
    dto.status === "has_mismatches" ||
    dto.status === "clean_match" ||
    dto.status === "needs_better_image" ||
    dto.status === "disposition_recorded" ||
    dto.status === "archived"
  );
}

/** 403 view for a case the principal may not see. */
function ForbiddenView({ caseId }: { caseId: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Access denied" />
      <Card>
        <p className="text-[13px] text-ink">
          You are not authorized to view this case.
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          Case access is scoped to batches assigned to you. If you believe this
          is an error, ask an admin to reassign the batch.
        </p>
        <p className="mt-2 font-mono text-[11px] text-muted-2">case:{caseId}</p>
      </Card>
    </div>
  );
}

/** Recoverable case-level error view with a retry / request-better-image path. */
function CaseErrorView({ caseId }: { caseId: string }) {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Case unavailable" />
      <Card>
        <p className="text-[13px] text-ink">
          This case could not be loaded right now.
        </p>
        <p className="mt-1 text-[12.5px] text-muted">
          This is usually transient. Refresh to retry. If the case keeps failing
          to load, an admin can replay processing from the operations console, or
          you can request a better image once the case is reachable.
        </p>
        <p className="mt-2 font-mono text-[11px] text-muted-2">case:{caseId}</p>
      </Card>
    </div>
  );
}
