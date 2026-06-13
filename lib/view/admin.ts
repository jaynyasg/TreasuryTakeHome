/**
 * Pure, framework-free view-model helpers for the admin Operations Console
 * (Stage 8 / T8).
 *
 * Encodes the "Product health metrics", "Operations Console", and "Storage
 * consistency"/reconciliation signals from
 * `docs/designs/production-gap-closure.md` as deterministic functions with NO
 * I/O, NO React, and NO Next imports. The server layer (`lib/server/admin.ts`)
 * shapes the raw `OpsHealthDTO` / reconciliation rows; THESE helpers turn those
 * metrics into UI signals (tile levels, formatted durations/spend/heartbeat,
 * reconciliation summary). Fully unit-tested (`tests/view/admin.test.ts`) — this
 * is the testable nucleus of Stage 8.
 *
 * Thresholds are exported named constants so the policy is documented in one
 * place and directly testable.
 */
import type { OpsHealthDTO, ReconciliationRowDTO } from "@/lib/server/adminDto";

/** A health signal level, escalating ok → warn → alert. */
export type HealthLevel = "ok" | "warn" | "alert";

/**
 * A two-sided threshold for a single numeric metric. A value at-or-above `warn`
 * is at least `warn`; at-or-above `alert` is `alert`. `warn <= alert` always.
 */
export interface MetricThresholds {
  warn: number;
  alert: number;
}

/**
 * Named ops thresholds (plan: "Product health metrics", "Runbooks and alerts").
 * Kept as exported consts so the alerting policy is documented + testable in one
 * place rather than scattered as magic numbers.
 */
export const OPS_THRESHOLDS = {
  /** Dead-letter jobs: any is a warning; a spike (>=5) is an alert. */
  deadLetter: { warn: 1, alert: 5 } as MetricThresholds,
  /** Oldest job age (seconds): >5m warns, >15m alerts (stuck-job runbook). */
  oldestJobAgeSeconds: { warn: 300, alert: 900 } as MetricThresholds,
  /** Cases finalized failed: any warns, a spike (>=10) alerts. */
  failed: { warn: 1, alert: 10 } as MetricThresholds,
  /** Export failures: any warns, repeated (>=3) alerts. */
  exportFailure: { warn: 1, alert: 3 } as MetricThresholds,
  /** Retention overdue rows: any is a warning (purge backlog). */
  retentionOverdue: { warn: 1, alert: 25 } as MetricThresholds,
  /** Needs-review backlog: large (>=25) warns, very large (>=100) alerts. */
  needsReview: { warn: 25, alert: 100 } as MetricThresholds,
  /** Queue depth: deep (>=50) warns, very deep (>=200) alerts. */
  queueDepth: { warn: 50, alert: 200 } as MetricThresholds,
} as const;

/**
 * Worker heartbeat staleness budget. A heartbeat older than this (or null) flips
 * the worker tile to `alert` — a lost heartbeat is the highest-signal outage.
 * Mirrors the worker's own `DEFAULT_STALE_AFTER_MS` (60s) in `worker/health.ts`.
 */
export const WORKER_HEARTBEAT_STALE_MS = 60_000;

/**
 * Classify a single ascending metric against its thresholds. Higher is worse:
 *   - value >= alert  → 'alert'
 *   - value >= warn   → 'warn'
 *   - otherwise       → 'ok'
 *
 * Boundaries are inclusive (value === warn is already `warn`). Thresholds with
 * `warn === alert` collapse to a two-state ok/alert signal.
 */
export function healthLevel(
  metric: number,
  thresholds: MetricThresholds
): HealthLevel {
  if (metric >= thresholds.alert) return "alert";
  if (metric >= thresholds.warn) return "warn";
  return "ok";
}

/** Take the most severe of two levels (alert > warn > ok). */
export function maxLevel(a: HealthLevel, b: HealthLevel): HealthLevel {
  const rank: Record<HealthLevel, number> = { ok: 0, warn: 1, alert: 2 };
  return rank[a] >= rank[b] ? a : b;
}

/**
 * Classify the worker heartbeat: `alert` when never seen (null) or older than
 * {@link WORKER_HEARTBEAT_STALE_MS}; otherwise `ok`. `now` is injected so the
 * helper stays pure and testable (no `Date.now()` inside).
 */
export function heartbeatLevel(
  at: string | null,
  now: number
): HealthLevel {
  if (at === null) return "alert";
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return "alert";
  return now - ms > WORKER_HEARTBEAT_STALE_MS ? "alert" : "ok";
}

/** One health tile shown in the Ops Health strip. */
export interface OpsTile {
  /** Stable key for React keys + tests. */
  key: string;
  /** Human label (never color-only — a11y). */
  label: string;
  /** Display value (already formatted for the tile). */
  value: string;
  /** Severity signal driving the tile's color/icon. */
  level: HealthLevel;
}

/** Result of {@link classifyOps}: the ordered tile set for the health strip. */
export interface OpsClassification {
  tiles: OpsTile[];
}

/**
 * Turn the raw {@link OpsHealthDTO} into the ordered, classified tile set the
 * Ops Health strip renders. Applies the named {@link OPS_THRESHOLDS} and the
 * heartbeat budget. `now` is injected (epoch ms) so heartbeat staleness is
 * deterministic and testable.
 *
 * Tile order puts the highest-signal operational health first: worker
 * heartbeat, dead-letters, queue depth/age, then the case/export/retention
 * backlogs and spend.
 */
export function classifyOps(
  health: OpsHealthDTO,
  now: number
): OpsClassification {
  const tiles: OpsTile[] = [
    {
      key: "worker",
      label: "Worker heartbeat",
      value: formatHeartbeat(health.workerLastHeartbeatAt, now),
      level: heartbeatLevel(health.workerLastHeartbeatAt, now),
    },
    {
      key: "deadLetter",
      label: "Dead-letter jobs",
      value: String(health.deadLetterCount),
      level: healthLevel(health.deadLetterCount, OPS_THRESHOLDS.deadLetter),
    },
    {
      key: "queueDepth",
      label: "Queue depth",
      value: String(health.queueDepth),
      level: healthLevel(health.queueDepth, OPS_THRESHOLDS.queueDepth),
    },
    {
      key: "oldestJob",
      label: "Oldest job age",
      value: formatDuration(health.oldestJobAgeSeconds),
      level: healthLevel(
        health.oldestJobAgeSeconds,
        OPS_THRESHOLDS.oldestJobAgeSeconds
      ),
    },
    {
      key: "inflight",
      label: "In-flight jobs",
      value: String(health.inflight),
      // In-flight work is informational, never an alert on its own.
      level: "ok",
    },
    {
      key: "retrying",
      label: "Retrying",
      value: String(health.retryingCount),
      // Retrying is expected churn; surfaced but not escalated.
      level: "ok",
    },
    {
      key: "failed",
      label: "Failed cases",
      value: String(health.failedCount),
      level: healthLevel(health.failedCount, OPS_THRESHOLDS.failed),
    },
    {
      key: "needsReview",
      label: "Needs review",
      value: String(health.needsReviewCount),
      level: healthLevel(health.needsReviewCount, OPS_THRESHOLDS.needsReview),
    },
    {
      key: "exportFailures",
      label: "Export failures",
      value: String(health.exportFailureCount),
      level: healthLevel(
        health.exportFailureCount,
        OPS_THRESHOLDS.exportFailure
      ),
    },
    {
      key: "retentionOverdue",
      label: "Retention overdue",
      value: String(health.retentionOverdueCount),
      level: healthLevel(
        health.retentionOverdueCount,
        OPS_THRESHOLDS.retentionOverdue
      ),
    },
    {
      key: "spend",
      label: "Est. model spend",
      value: formatSpend(health.estimatedSpendUsd),
      // Spend is informational on the health strip; budget caps live elsewhere.
      level: "ok",
    },
  ];
  return { tiles };
}

/**
 * The single worst level across all classified tiles — the strip's overall
 * banner signal. `ok` for an empty/healthy set.
 */
export function overallLevel(classification: OpsClassification): HealthLevel {
  return classification.tiles.reduce<HealthLevel>(
    (acc, tile) => maxLevel(acc, tile.level),
    "ok"
  );
}

/**
 * Format a non-negative duration in seconds as a compact human string:
 * "0s", "45s", "3m 20s", "1h 5m". Negative / non-finite inputs clamp to "0s".
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  return `${s}s`;
}

/**
 * Format an estimated spend as USD with two decimals: 0 → "$0.00",
 * 12.5 → "$12.50". Negative / non-finite inputs clamp to "$0.00".
 */
export function formatSpend(usd: number): string {
  const value = Number.isFinite(usd) && usd > 0 ? usd : 0;
  return `$${value.toFixed(2)}`;
}

/**
 * Format the worker heartbeat relative to `now` (epoch ms): "12s ago",
 * "3m ago", "1h ago", or "no heartbeat" when null/unparseable. A future
 * timestamp (clock skew) reads as "just now".
 */
export function formatHeartbeat(at: string | null, now: number): string {
  if (at === null) return "no heartbeat";
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return "no heartbeat";

  const deltaSec = Math.floor((now - ms) / 1000);
  if (deltaSec <= 0) return "just now";
  return `${formatDuration(deltaSec)} ago`;
}

/** Summary of a storage reconciliation sweep for the strip + tab header. */
export interface ReconciliationSummary {
  /** DB manifest rows whose blob is missing (missing_blob findings). */
  missing: number;
  /** Blobs with no DB manifest row (orphaned_blob findings). */
  orphaned: number;
  /** True when there are zero findings of either kind. */
  healthy: boolean;
}

/**
 * Tally a reconciliation sweep into missing/orphaned counts and an overall
 * `healthy` flag (plan: "Storage consistency"). Healthy means zero drift in
 * either direction — every DB row has its blob and every blob has its row.
 */
export function summarizeReconciliation(
  rows: readonly ReconciliationRowDTO[]
): ReconciliationSummary {
  let missing = 0;
  let orphaned = 0;
  for (const row of rows) {
    if (row.issue === "missing_blob") missing += 1;
    else if (row.issue === "orphaned_blob") orphaned += 1;
  }
  return { missing, orphaned, healthy: missing === 0 && orphaned === 0 };
}
