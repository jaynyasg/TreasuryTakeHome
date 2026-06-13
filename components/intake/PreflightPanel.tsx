"use client";

import Card from "@/components/house/Card";
import IconButton from "@/components/house/IconButton";
import Badge from "@/components/house/Badge";
import { Bolt, Check } from "@/components/house/icons";
import type { PreflightSummary } from "@/lib/intake/types";
import { formatCost, formatDuration, groupIssues } from "./format";

/**
 * Preflight summary + the primary Start action for the Batch Intake screen
 * (Stage 7 Wave 2; journey step 2: "Processing does not begin until the
 * manifest is reviewable").
 *
 * Shows the case counts (complete / incomplete / duplicates / unsupported),
 * the estimated cost and time, and the grouped issues with plain-language
 * guidance — then the one obvious Start button. Start is disabled until there
 * is at least one complete case; the disabled reason is always spelled out so a
 * non-technical reviewer is never left guessing why they can't proceed.
 */
export default function PreflightPanel({
  summary,
  starting,
  onStart,
  startError,
}: {
  summary: PreflightSummary | null;
  /** True while the Start request is in flight. */
  starting: boolean;
  onStart: () => void;
  /** A failure message from the Start request, if any. */
  startError?: string | null;
}) {
  const canStart = (summary?.completeCases ?? 0) > 0;
  const groups = summary ? groupIssues(summary.issues) : [];

  return (
    <Card>
      <div className="mb-3">
        <h2 className="text-[15px] font-semibold">Review before you start</h2>
        <p className="mt-0.5 text-[12px] text-muted">
          Nothing is processed until you press Start. Check the counts below
          first.
        </p>
      </div>

      {!summary ? (
        <p className="rounded-lg border border-dashed border-line bg-surface/40 px-3 py-4 text-[12.5px] text-muted">
          Add files above and the summary will appear here.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-2.5">
            <Stat
              label="Ready to process"
              value={summary.completeCases}
              tone={summary.completeCases > 0 ? "good" : "muted"}
              hint="complete application + label pairs"
            />
            <Stat
              label="Incomplete"
              value={summary.incompleteCases}
              tone={summary.incompleteCases > 0 ? "warn" : "muted"}
              hint="missing a paired file"
            />
            <Stat
              label="Duplicates skipped"
              value={summary.duplicates}
              tone="muted"
              hint="same file uploaded twice"
            />
            <Stat
              label="Unsupported"
              value={summary.unsupported}
              tone={summary.unsupported > 0 ? "bad" : "muted"}
              hint="wrong file type"
            />
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line-2 bg-surface/40 px-3 py-2.5 text-[12.5px]">
            <span className="text-muted">Estimated cost</span>
            <span className="font-semibold text-ink">
              {formatCost(summary.estimatedCostUsd)}
            </span>
            <span className="text-muted-2">·</span>
            <span className="text-muted">Estimated time</span>
            <span className="font-semibold text-ink">
              {formatDuration(summary.estimatedMinutes)}
            </span>
          </div>
          <p className="mt-1.5 text-[11px] text-muted">
            Estimates only — you are never charged here.
          </p>

          {groups.length > 0 && (
            <div className="mt-4 space-y-3">
              <h3 className="text-[12.5px] font-semibold text-ink">
                Things to look at
              </h3>
              {groups.map((group) => (
                <div
                  key={group.kind}
                  className="rounded-lg border border-line-2 bg-card p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold text-ink-2">
                      {group.heading}
                    </span>
                    <Badge>{group.issues.length}</Badge>
                  </div>
                  <p className="mt-1 text-[12px] text-muted">{group.guidance}</p>
                  <ul className="mt-2 space-y-1">
                    {group.issues.map((issue, i) => (
                      <li
                        key={`${group.kind}-${issue.caseKey ?? issue.fileName ?? i}`}
                        className="text-[11.5px] text-muted"
                      >
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          <div className="mt-5 border-t border-line-2 pt-4">
            <IconButton
              icon={canStart ? <Bolt /> : <Check />}
              loading={starting}
              disabled={starting || !canStart}
              onClick={onStart}
              className="w-full"
            >
              {starting
                ? "Starting batch…"
                : canStart
                  ? `Start processing ${summary.completeCases} case${
                      summary.completeCases === 1 ? "" : "s"
                    }`
                  : "Add a complete pair to start"}
            </IconButton>
            {!canStart && (
              <p className="mt-2 text-[11.5px] text-muted">
                You need at least one case with both an application and a label
                before processing can begin.
              </p>
            )}
            {startError && (
              <p className="mt-3 rounded-lg border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[12.5px] text-accent-red">
                {startError}
              </p>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

type StatTone = "good" | "warn" | "bad" | "muted";

const STAT_TONE: Record<StatTone, string> = {
  good: "border-accent-green/40 bg-accent-green/5",
  warn: "border-accent-amber/50 bg-accent-amber/5",
  bad: "border-accent-red/40 bg-accent-red/5",
  muted: "border-line-2 bg-surface/40",
};

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: StatTone;
  hint: string;
}) {
  return (
    <div className={"rounded-lg border p-2.5 " + STAT_TONE[tone]}>
      <dt className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 text-[20px] font-semibold leading-none text-ink">
        {value}
      </dd>
      <dd className="mt-1 text-[11px] text-muted">{hint}</dd>
    </div>
  );
}
