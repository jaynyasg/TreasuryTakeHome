import { describe, expect, it } from "vitest";
import {
  healthLevel,
  heartbeatLevel,
  maxLevel,
  classifyOps,
  overallLevel,
  formatDuration,
  formatSpend,
  formatHeartbeat,
  summarizeReconciliation,
  OPS_THRESHOLDS,
  WORKER_HEARTBEAT_STALE_MS,
  type HealthLevel,
} from "@/lib/view/admin";
import type {
  OpsHealthDTO,
  ReconciliationRowDTO,
} from "@/lib/server/adminDto";

/** A fixed "now" so heartbeat staleness is deterministic. */
const NOW = Date.parse("2026-06-13T12:00:00.000Z");

/** A fully-healthy OpsHealthDTO, overridable per test. */
function health(over: Partial<OpsHealthDTO> = {}): OpsHealthDTO {
  return {
    queueDepth: 0,
    oldestJobAgeSeconds: 0,
    inflight: 0,
    deadLetterCount: 0,
    retryingCount: 0,
    needsReviewCount: 0,
    failedCount: 0,
    exportFailureCount: 0,
    retentionOverdueCount: 0,
    // 10s ago — fresh heartbeat.
    workerLastHeartbeatAt: new Date(NOW - 10_000).toISOString(),
    estimatedSpendUsd: 0,
    ...over,
  };
}

function tileLevel(
  classification: ReturnType<typeof classifyOps>,
  key: string
): HealthLevel {
  const tile = classification.tiles.find((t) => t.key === key);
  if (!tile) throw new Error(`no tile ${key}`);
  return tile.level;
}

function tileValue(
  classification: ReturnType<typeof classifyOps>,
  key: string
): string {
  const tile = classification.tiles.find((t) => t.key === key);
  if (!tile) throw new Error(`no tile ${key}`);
  return tile.value;
}

describe("healthLevel", () => {
  const t = { warn: 1, alert: 5 };

  it("is ok below the warn threshold", () => {
    expect(healthLevel(0, t)).toBe("ok");
  });

  it("warns exactly at the warn boundary (inclusive)", () => {
    expect(healthLevel(1, t)).toBe("warn");
  });

  it("stays warn between warn and alert", () => {
    expect(healthLevel(4, t)).toBe("warn");
  });

  it("alerts exactly at the alert boundary (inclusive)", () => {
    expect(healthLevel(5, t)).toBe("alert");
  });

  it("alerts above the alert threshold", () => {
    expect(healthLevel(50, t)).toBe("alert");
  });

  it("collapses to ok/alert when warn === alert", () => {
    const c = { warn: 3, alert: 3 };
    expect(healthLevel(2, c)).toBe("ok");
    expect(healthLevel(3, c)).toBe("alert");
  });

  it("matches the documented dead-letter policy (>0 warn, >=5 alert)", () => {
    expect(healthLevel(0, OPS_THRESHOLDS.deadLetter)).toBe("ok");
    expect(healthLevel(1, OPS_THRESHOLDS.deadLetter)).toBe("warn");
    expect(healthLevel(5, OPS_THRESHOLDS.deadLetter)).toBe("alert");
  });

  it("matches the documented oldest-job-age policy (>300s warn)", () => {
    expect(healthLevel(299, OPS_THRESHOLDS.oldestJobAgeSeconds)).toBe("ok");
    expect(healthLevel(300, OPS_THRESHOLDS.oldestJobAgeSeconds)).toBe("warn");
    expect(healthLevel(900, OPS_THRESHOLDS.oldestJobAgeSeconds)).toBe("alert");
  });
});

describe("maxLevel", () => {
  it("returns the more severe of two levels", () => {
    expect(maxLevel("ok", "warn")).toBe("warn");
    expect(maxLevel("warn", "alert")).toBe("alert");
    expect(maxLevel("alert", "ok")).toBe("alert");
    expect(maxLevel("ok", "ok")).toBe("ok");
  });
});

describe("heartbeatLevel", () => {
  it("is ok for a fresh heartbeat within the budget", () => {
    const at = new Date(NOW - (WORKER_HEARTBEAT_STALE_MS - 1)).toISOString();
    expect(heartbeatLevel(at, NOW)).toBe("ok");
  });

  it("alerts when the heartbeat is older than the budget", () => {
    const at = new Date(NOW - (WORKER_HEARTBEAT_STALE_MS + 1)).toISOString();
    expect(heartbeatLevel(at, NOW)).toBe("alert");
  });

  it("alerts when the heartbeat is null (never seen)", () => {
    expect(heartbeatLevel(null, NOW)).toBe("alert");
  });

  it("alerts on an unparseable timestamp", () => {
    expect(heartbeatLevel("not-a-date", NOW)).toBe("alert");
  });
});

describe("classifyOps", () => {
  it("produces all-ok tiles for a healthy system", () => {
    const out = classifyOps(health(), NOW);
    for (const tile of out.tiles) {
      expect(tile.level).toBe("ok");
    }
    expect(overallLevel(out)).toBe("ok");
  });

  it("warns on a single dead-letter and alerts on a spike", () => {
    expect(tileLevel(classifyOps(health({ deadLetterCount: 1 }), NOW), "deadLetter")).toBe(
      "warn"
    );
    expect(tileLevel(classifyOps(health({ deadLetterCount: 5 }), NOW), "deadLetter")).toBe(
      "alert"
    );
  });

  it("warns when the oldest job exceeds 5 minutes", () => {
    const out = classifyOps(health({ oldestJobAgeSeconds: 301 }), NOW);
    expect(tileLevel(out, "oldestJob")).toBe("warn");
    expect(tileValue(out, "oldestJob")).toBe("5m 1s");
  });

  it("alerts when the worker heartbeat is null", () => {
    const out = classifyOps(health({ workerLastHeartbeatAt: null }), NOW);
    expect(tileLevel(out, "worker")).toBe("alert");
    expect(tileValue(out, "worker")).toBe("no heartbeat");
    expect(overallLevel(out)).toBe("alert");
  });

  it("alerts when the worker heartbeat is stale", () => {
    const stale = new Date(NOW - (WORKER_HEARTBEAT_STALE_MS + 5_000)).toISOString();
    const out = classifyOps(health({ workerLastHeartbeatAt: stale }), NOW);
    expect(tileLevel(out, "worker")).toBe("alert");
  });

  it("warns when retention is overdue", () => {
    const out = classifyOps(health({ retentionOverdueCount: 1 }), NOW);
    expect(tileLevel(out, "retentionOverdue")).toBe("warn");
  });

  it("keeps inflight / retrying / spend informational (never escalates them)", () => {
    const out = classifyOps(
      health({ inflight: 999, retryingCount: 999, estimatedSpendUsd: 999 }),
      NOW
    );
    expect(tileLevel(out, "inflight")).toBe("ok");
    expect(tileLevel(out, "retrying")).toBe("ok");
    expect(tileLevel(out, "spend")).toBe("ok");
  });

  it("overall level reflects the worst tile", () => {
    // deadLetter spike => alert dominates a healthy rest.
    const out = classifyOps(health({ deadLetterCount: 7 }), NOW);
    expect(overallLevel(out)).toBe("alert");
  });

  it("formats the spend tile as USD", () => {
    const out = classifyOps(health({ estimatedSpendUsd: 12.5 }), NOW);
    expect(tileValue(out, "spend")).toBe("$12.50");
  });
});

describe("formatDuration", () => {
  it("clamps zero / negative / non-finite to 0s", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(-5)).toBe("0s");
    expect(formatDuration(Number.NaN)).toBe("0s");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0s");
  });

  it("formats seconds only", () => {
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes and seconds", () => {
    expect(formatDuration(200)).toBe("3m 20s");
  });

  it("drops the trailing 0s when on a whole minute", () => {
    expect(formatDuration(120)).toBe("2m");
  });

  it("formats hours and minutes", () => {
    expect(formatDuration(3900)).toBe("1h 5m");
  });

  it("drops the trailing 0m on a whole hour", () => {
    expect(formatDuration(3600)).toBe("1h");
  });
});

describe("formatSpend", () => {
  it("formats zero", () => {
    expect(formatSpend(0)).toBe("$0.00");
  });

  it("formats two decimals", () => {
    expect(formatSpend(12.5)).toBe("$12.50");
    expect(formatSpend(3.14159)).toBe("$3.14");
  });

  it("clamps negative / non-finite to $0.00", () => {
    expect(formatSpend(-1)).toBe("$0.00");
    expect(formatSpend(Number.NaN)).toBe("$0.00");
  });
});

describe("formatHeartbeat", () => {
  it("returns 'no heartbeat' for null", () => {
    expect(formatHeartbeat(null, NOW)).toBe("no heartbeat");
  });

  it("returns 'no heartbeat' for an unparseable timestamp", () => {
    expect(formatHeartbeat("nope", NOW)).toBe("no heartbeat");
  });

  it("formats a recent heartbeat in seconds", () => {
    const at = new Date(NOW - 12_000).toISOString();
    expect(formatHeartbeat(at, NOW)).toBe("12s ago");
  });

  it("formats an older heartbeat in minutes", () => {
    const at = new Date(NOW - 3 * 60_000).toISOString();
    expect(formatHeartbeat(at, NOW)).toBe("3m ago");
  });

  it("reads a future timestamp (clock skew) as 'just now'", () => {
    const at = new Date(NOW + 5_000).toISOString();
    expect(formatHeartbeat(at, NOW)).toBe("just now");
  });
});

describe("summarizeReconciliation", () => {
  function row(over: Partial<ReconciliationRowDTO>): ReconciliationRowDTO {
    return {
      objectKey: over.objectKey ?? "k",
      issue: over.issue ?? "missing_blob",
      aggregateType: over.aggregateType ?? "case_file",
      aggregateId: over.aggregateId ?? null,
    };
  }

  it("is healthy with no findings", () => {
    const out = summarizeReconciliation([]);
    expect(out).toEqual({ missing: 0, orphaned: 0, healthy: true });
  });

  it("counts missing and orphaned separately", () => {
    const out = summarizeReconciliation([
      row({ objectKey: "a", issue: "missing_blob" }),
      row({ objectKey: "b", issue: "missing_blob" }),
      row({ objectKey: "c", issue: "orphaned_blob" }),
    ]);
    expect(out.missing).toBe(2);
    expect(out.orphaned).toBe(1);
    expect(out.healthy).toBe(false);
  });

  it("is unhealthy when only missing exist", () => {
    const out = summarizeReconciliation([row({ issue: "missing_blob" })]);
    expect(out.healthy).toBe(false);
  });

  it("is unhealthy when only orphaned exist", () => {
    const out = summarizeReconciliation([row({ issue: "orphaned_blob" })]);
    expect(out.healthy).toBe(false);
  });
});
