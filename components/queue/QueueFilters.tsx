"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { CaseState } from "@/lib/core/state/case";
import type { QueueSeverity } from "@/lib/server/dto";

/**
 * Client filter controls for the Work Queue (Stage 7 / T7, Wave 2).
 *
 * Drives the queue by mutating the URL searchParams (`useRouter` +
 * `useSearchParams`) — the server component re-reads them and re-queries, so the
 * filtered set is shareable/bookmarkable and survives refresh. Sticky on desktop
 * so the controls stay reachable while scrolling a long table.
 *
 * Behavior guardrails from the plan ("Triage rendering", Work Queue row in the
 * Core UI State Table / Responsive specs):
 *  - Changing a filter resets the cursor (never paginate a stale predicate).
 *  - We do NOT auto-reshuffle the viewport on live data; filter changes are an
 *    explicit user action, and we debounce the router push so rapid toggles
 *    don't stack navigations.
 *  - `isAdmin` unlocks the "mine | all" assignment toggle; reviewers are always
 *    scoped to their assigned cases server-side, so the toggle is hidden.
 */

const SEVERITY_OPTIONS: ReadonlyArray<{ value: "" | QueueSeverity; label: string }> = [
  { value: "", label: "All severities" },
  { value: "red", label: "Red" },
  { value: "amber", label: "Amber" },
  { value: "green", label: "Green" },
  { value: "none", label: "Unscored" },
];

// A curated, reviewer-relevant subset of case states (the full lifecycle has
// internal/transient states a reviewer rarely filters by directly).
const STATUS_OPTIONS: ReadonlyArray<{ value: "" | CaseState; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "needs_review", label: "Needs review" },
  { value: "has_mismatches", label: "Mismatches" },
  { value: "needs_better_image", label: "Needs better image" },
  { value: "failed", label: "Failed" },
  { value: "dead_letter", label: "Dead-letter" },
  { value: "clean_match", label: "Clean match" },
  { value: "disposition_recorded", label: "Dispositioned" },
];

const selectClass =
  "min-h-[44px] rounded-lg border border-line bg-card px-2.5 text-[13px] text-ink " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40";

export default function QueueFilters({
  severity,
  status,
  assignment,
  isAdmin,
}: {
  severity: "" | QueueSeverity;
  status: "" | CaseState;
  assignment: "mine" | "all";
  isAdmin: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  // Track the most recent intended value so the live region announces only the
  // last debounced change, not every keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [announce, setAnnounce] = useState("");

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const pushParams = useCallback(
    (mutate: (next: URLSearchParams) => void, announcement: string) => {
      const next = new URLSearchParams(searchParams.toString());
      mutate(next);
      // Any filter change invalidates the cursor — start the page from the top.
      next.delete("cursor");
      const qs = next.toString();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        startTransition(() => {
          router.push(qs ? `/reviewer/queue?${qs}` : "/reviewer/queue", {
            scroll: false,
          });
        });
        setAnnounce(announcement);
      }, 200);
    },
    [router, searchParams]
  );

  const setParam = useCallback(
    (key: string, value: string, announcement: string) => {
      pushParams((next) => {
        if (value) next.set(key, value);
        else next.delete(key);
      }, announcement);
    },
    [pushParams]
  );

  return (
    <div className="sticky top-0 z-10 -mx-1 flex flex-wrap items-end gap-3 bg-canvas/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-canvas/80">
      <div className="flex flex-col gap-1">
        <label htmlFor="queue-severity" className="text-[11px] font-medium text-muted">
          Severity
        </label>
        <select
          id="queue-severity"
          className={selectClass}
          value={severity}
          onChange={(e) =>
            setParam(
              "severity",
              e.target.value,
              `Filtered to ${e.target.value || "all severities"}`
            )
          }
        >
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="queue-status" className="text-[11px] font-medium text-muted">
          Status
        </label>
        <select
          id="queue-status"
          className={selectClass}
          value={status}
          onChange={(e) =>
            setParam(
              "status",
              e.target.value,
              `Filtered to ${e.target.value || "all statuses"}`
            )
          }
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value || "all"} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {isAdmin && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-muted" id="queue-assignment-label">
            Assignment
          </span>
          <div
            role="group"
            aria-labelledby="queue-assignment-label"
            className="inline-flex overflow-hidden rounded-lg border border-line"
          >
            {(["mine", "all"] as const).map((value) => {
              const active = assignment === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setParam(
                      "assignment",
                      value,
                      value === "mine" ? "Showing my cases" : "Showing all cases"
                    )
                  }
                  className={
                    "min-h-[44px] px-3 text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 " +
                    (active
                      ? "bg-ink text-white"
                      : "bg-card text-ink-2 hover:bg-surface hover:text-ink")
                  }
                >
                  {value === "mine" ? "Mine" : "All"}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isPending && (
        <span className="self-center text-[11.5px] text-muted-2" aria-hidden>
          Updating…
        </span>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
