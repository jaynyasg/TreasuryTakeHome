import { describe, expect, it } from "vitest";
import {
  gateAction,
  hasOverridableConcern,
  reasonRequired,
  validateSubmission,
} from "./dispositionRules";
import type { CaseDetailView, FieldComparison } from "./types";

/**
 * Unit tests for the pure Case Detail disposition rules (plan "Disposition
 * Interaction Rules"). Run directly with `npx vitest run components/case/...`
 * (the repo's default `tests/**` include glob does not pick up co-located
 * component tests; this exercises the gate logic without a DB or React).
 */

function view(overrides: Partial<CaseDetailView> = {}): CaseDetailView {
  return {
    dto: {
      caseId: "c1",
      batchId: "b1",
      batchName: "Batch 1",
      severity: "green",
      status: "clean_match",
      brand: "Brand",
      classType: "Wine",
      applicant: "Acme",
      assignedUserId: "u1",
      assignedToMe: true,
      updatedAt: "2026-06-13T00:00:00.000Z",
    },
    ...overrides,
  };
}

const cleanFields: FieldComparison[] = [
  { field: "brandName", status: "match", applicationValue: "X", labelValue: "X", reason: "ok" },
];
const concernFields: FieldComparison[] = [
  { field: "brandName", status: "mismatch", applicationValue: "X", labelValue: "Y", reason: "diff" },
];

describe("reasonRequired", () => {
  it("never requires a reason to approve a clean green case", () => {
    expect(reasonRequired("approve", view({ fields: cleanFields }))).toBe(false);
  });

  it("requires a reason to approve over a field concern", () => {
    expect(reasonRequired("approve", view({ fields: concernFields }))).toBe(true);
  });

  it("requires a reason to approve over a needs_review machine verdict", () => {
    expect(
      reasonRequired("approve", view({ machine: { overall: "needs_review", matchPercentage: 70, summary: null } }))
    ).toBe(true);
  });

  it("always requires a reason to reject", () => {
    expect(reasonRequired("reject", view({ fields: cleanFields }))).toBe(true);
  });

  it("always requires a reason to request a better image", () => {
    expect(reasonRequired("request_better_image", view({ fields: cleanFields }))).toBe(true);
  });
});

describe("hasOverridableConcern", () => {
  it("flags has_mismatches machine verdicts", () => {
    expect(
      hasOverridableConcern(view({ machine: { overall: "has_mismatches", matchPercentage: 50, summary: null } }))
    ).toBe(true);
  });
  it("is false for a clean view", () => {
    expect(hasOverridableConcern(view({ fields: cleanFields }))).toBe(false);
  });
});

describe("gateAction", () => {
  it("enables Approve only once evidence is loaded", () => {
    const notLoaded = gateAction("approve", view(), { evidenceLoaded: false });
    expect(notLoaded.enabled).toBe(false);
    const loaded = gateAction("approve", view(), { evidenceLoaded: true });
    expect(loaded.enabled).toBe(true);
  });

  it("disables final actions when a disposition already exists", () => {
    const v = view({
      disposition: {
        action: "approve",
        actorUserId: "u1",
        at: "2026-06-13T01:00:00.000Z",
        reason: null,
        includedInExport: true,
      },
    });
    expect(gateAction("approve", v, { evidenceLoaded: true }).enabled).toBe(false);
    expect(gateAction("reject", v, { evidenceLoaded: true }).enabled).toBe(false);
  });

  it("disables final actions on a stale view and names the changer", () => {
    const v = view({ stale: true, staleChangedBy: "admin@ttb" });
    const gate = gateAction("reject", v, { evidenceLoaded: true });
    expect(gate.enabled).toBe(false);
    expect(gate.disabledReason).toContain("admin@ttb");
  });

  it("disables when status is already disposition_recorded", () => {
    const v = view({ dto: { ...view().dto, status: "disposition_recorded" } });
    expect(gateAction("approve", v, { evidenceLoaded: true }).enabled).toBe(false);
  });

  it("reject does not need evidence loaded to be enabled", () => {
    expect(gateAction("reject", view(), { evidenceLoaded: false }).enabled).toBe(true);
  });
});

describe("validateSubmission", () => {
  it("blocks reject without a reason", () => {
    expect(validateSubmission("reject", view(), { reason: "  " })).toMatch(/reason is required/i);
  });

  it("allows reject with a reason", () => {
    expect(validateSubmission("reject", view(), { reason: "blurry label" })).toBeNull();
  });

  it("blocks request_better_image without a category", () => {
    expect(
      validateSubmission("request_better_image", view(), { reason: "x", category: "" })
    ).toMatch(/category/i);
  });

  it("blocks approve-over-concern without a note", () => {
    expect(validateSubmission("approve", view({ fields: concernFields }), { reason: null })).toMatch(
      /note is required/i
    );
  });

  it("allows clean approve with no note", () => {
    expect(validateSubmission("approve", view({ fields: cleanFields }), { reason: null })).toBeNull();
  });
});
