import { describe, expect, it } from "vitest";
import {
  verdictPayloadToFields,
  mergeTimeline,
  type TimelineAttemptInput,
  type TimelineDispositionInput,
  type TimelineAuditInput,
} from "@/lib/server/caseDetailMappers";

/**
 * Pure unit tests for the Case Detail mappers (Stage 7 / T7, Wave 2). No DB:
 * these exercise the verdict-payload parse-or-empty handling and the timeline
 * merge/sort — the testable nucleus of `getCaseDetail`.
 */

describe("verdictPayloadToFields", () => {
  const verdict = {
    field: "brandName",
    status: "match",
    applicationValue: "Acme",
    labelValue: "Acme",
    reason: "exact match",
  };

  it("parses a full MatchReport payload into field rows", () => {
    const payload = {
      matchPercentage: 100,
      overall: "all_match",
      summary: "all good",
      verdicts: [verdict],
    };
    const fields = verdictPayloadToFields(payload);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toEqual({
      field: "brandName",
      status: "match",
      applicationValue: "Acme",
      labelValue: "Acme",
      reason: "exact match",
    });
  });

  it("falls back to a bare verdicts array when the report shape is incomplete", () => {
    // No matchPercentage/overall/summary — MatchReport fails, .verdicts salvaged.
    const fields = verdictPayloadToFields({ verdicts: [verdict] });
    expect(fields).toHaveLength(1);
    expect(fields[0].field).toBe("brandName");
  });

  it("falls back to a bare top-level array of verdicts", () => {
    const fields = verdictPayloadToFields([verdict]);
    expect(fields).toHaveLength(1);
  });

  it("skips malformed entries and returns empty for junk", () => {
    expect(verdictPayloadToFields(null)).toEqual([]);
    expect(verdictPayloadToFields("nope")).toEqual([]);
    expect(verdictPayloadToFields({ verdicts: [{ field: "brandName" }] })).toEqual([]);
    expect(
      verdictPayloadToFields([verdict, { field: "bogusField", status: "match" }])
    ).toHaveLength(1);
  });
});

describe("mergeTimeline", () => {
  const attempt: TimelineAttemptInput = {
    id: "a1",
    stage: "scoring",
    attempt_no: 1,
    state: "succeeded",
    error_class: null,
    created_at: "2026-01-01T00:00:02.000Z",
  };
  const disposition: TimelineDispositionInput = {
    id: "d1",
    actor_user_id: "u1",
    action: "reject",
    reason: "brand mismatch",
    created_at: "2026-01-01T00:00:03.000Z",
  };
  const audit: TimelineAuditInput = {
    id: "e1",
    actor_user_id: null,
    action: "case.state_change",
    reason: null,
    created_at: "2026-01-01T00:00:01.000Z",
  };

  it("merges all three sources sorted ascending by timestamp", () => {
    const merged = mergeTimeline({
      attempts: [attempt],
      dispositions: [disposition],
      audits: [audit],
    });
    expect(merged.map((e) => e.kind)).toEqual([
      "state_change",
      "attempt",
      "disposition",
    ]);
  });

  it("tags status-changing audit events as state_change, others as audit", () => {
    const merged = mergeTimeline({
      attempts: [],
      dispositions: [],
      audits: [
        audit,
        { ...audit, id: "e2", action: "case.note_added", created_at: "2026-01-01T00:00:05.000Z" },
      ],
    });
    expect(merged[0].kind).toBe("state_change");
    expect(merged[1].kind).toBe("audit");
  });

  it("carries actor + reason through and builds readable summaries", () => {
    const merged = mergeTimeline({
      attempts: [attempt],
      dispositions: [disposition],
      audits: [],
    });
    const dispEntry = merged.find((e) => e.kind === "disposition");
    expect(dispEntry?.actorUserId).toBe("u1");
    expect(dispEntry?.reason).toBe("brand mismatch");
    expect(dispEntry?.summary).toBe("Reviewer rejected the case");
    const attemptEntry = merged.find((e) => e.kind === "attempt");
    expect(attemptEntry?.summary).toBe("Scoring attempt 1 succeeded");
    expect(attemptEntry?.action).toBe("scoring.succeeded");
  });

  it("uses id as a stable tiebreaker for equal timestamps", () => {
    const t = "2026-01-01T00:00:00.000Z";
    const merged = mergeTimeline({
      attempts: [{ ...attempt, id: "z", created_at: t }],
      dispositions: [{ ...disposition, id: "a", created_at: t }],
      audits: [],
    });
    // ids "attempt:z" vs "disposition:a" — sorted lexicographically on prefixed id.
    expect(merged[0].id).toBe("attempt:z");
    expect(merged[1].id).toBe("disposition:a");
  });
});
