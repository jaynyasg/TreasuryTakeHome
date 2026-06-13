import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  assertBatchAccess,
  authorizeBatchAccess,
  decideAccess,
  ForbiddenError,
  type Action,
  type Principal,
} from "@/lib/auth/authorize";
import type { DbClient } from "@/lib/db/client";
import { insertAssignment } from "@/lib/db/repositories/assignments";
import { insertBatch } from "@/lib/db/repositories/batches";
import { migratedClient, seedUser } from "../db/helpers";

const admin: Principal = { userId: "admin-1", role: "admin" };
const reviewer: Principal = { userId: "rev-1", role: "reviewer" };

describe("decideAccess (pure core)", () => {
  interface Case {
    name: string;
    principal: Principal;
    action: Action;
    assigned?: boolean;
    expectedAllowed: boolean;
    expectedAudit: boolean;
  }

  const cases: Case[] = [
    {
      name: "admin read — allowed, no audit",
      principal: admin,
      action: "read",
      expectedAllowed: true,
      expectedAudit: false,
    },
    {
      name: "admin purge — allowed, requiresAudit",
      principal: admin,
      action: "purge",
      expectedAllowed: true,
      expectedAudit: true,
    },
    {
      name: "admin write — allowed, requiresAudit",
      principal: admin,
      action: "write",
      expectedAllowed: true,
      expectedAudit: true,
    },
    {
      name: "reviewer read assigned — allowed",
      principal: reviewer,
      action: "read",
      assigned: true,
      expectedAllowed: true,
      expectedAudit: false,
    },
    {
      name: "reviewer read unassigned — denied",
      principal: reviewer,
      action: "read",
      assigned: false,
      expectedAllowed: false,
      expectedAudit: false,
    },
    {
      name: "reviewer dispose assigned — allowed, requiresAudit",
      principal: reviewer,
      action: "dispose",
      assigned: true,
      expectedAllowed: true,
      expectedAudit: true,
    },
    {
      name: "reviewer write assigned — allowed, requiresAudit",
      principal: reviewer,
      action: "write",
      assigned: true,
      expectedAllowed: true,
      expectedAudit: true,
    },
    {
      name: "reviewer export assigned — allowed, requiresAudit",
      principal: reviewer,
      action: "export",
      assigned: true,
      expectedAllowed: true,
      expectedAudit: true,
    },
    {
      name: "reviewer export unassigned — denied",
      principal: reviewer,
      action: "export",
      assigned: false,
      expectedAllowed: false,
      expectedAudit: false,
    },
    {
      name: "reviewer assign — denied (admin only)",
      principal: reviewer,
      action: "assign",
      assigned: true,
      expectedAllowed: false,
      expectedAudit: false,
    },
    {
      name: "reviewer replay — denied (admin only)",
      principal: reviewer,
      action: "replay",
      assigned: true,
      expectedAllowed: false,
      expectedAudit: false,
    },
    {
      name: "reviewer purge — denied (admin only)",
      principal: reviewer,
      action: "purge",
      assigned: true,
      expectedAllowed: false,
      expectedAudit: false,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const decision = decideAccess(c.principal, {
        aggregateType: "batch",
        action: c.action,
        isAssignedToPrincipal: c.assigned,
      });
      expect(decision.allowed).toBe(c.expectedAllowed);
      expect(decision.requiresAudit).toBe(c.expectedAudit);
      expect(decision.reason).toBeTruthy();
    });
  }

  it("unknown/default — denied (unrecognized role falls through)", () => {
    const rogue = { userId: "x", role: "superuser" } as unknown as Principal;
    const decision = decideAccess(rogue, {
      aggregateType: "case",
      action: "read",
    });
    expect(decision.allowed).toBe(false);
    expect(decision.requiresAudit).toBe(false);
    expect(decision.reason).toMatch(/default deny/);
  });
});

describe("authorizeBatchAccess / assertBatchAccess (DB-backed)", () => {
  let db: DbClient;
  let assignedReviewerId: string;
  let otherReviewerId: string;
  let adminId: string;

  beforeEach(async () => {
    db = await migratedClient();
    assignedReviewerId = await seedUser(db, "reviewer");
    otherReviewerId = await seedUser(db, "reviewer");
    adminId = await seedUser(db, "admin");

    await insertBatch(db, { id: "batch-1", ownerUserId: assignedReviewerId });
    await insertAssignment(db, {
      id: "assign-1",
      batchId: "batch-1",
      userId: assignedReviewerId,
    });
  });

  afterEach(async () => {
    await db.close();
  });

  it("allows an assigned reviewer to read", async () => {
    const principal: Principal = {
      userId: assignedReviewerId,
      role: "reviewer",
    };
    const decision = await authorizeBatchAccess(
      db,
      principal,
      "batch-1",
      "read"
    );
    expect(decision.allowed).toBe(true);
    expect(decision.requiresAudit).toBe(false);

    const result = await assertBatchAccess(db, principal, "batch-1", "read");
    expect(result.requiresAudit).toBe(false);
  });

  it("denies an unassigned reviewer (ForbiddenError from assert)", async () => {
    const principal: Principal = { userId: otherReviewerId, role: "reviewer" };

    const decision = await authorizeBatchAccess(
      db,
      principal,
      "batch-1",
      "read"
    );
    expect(decision.allowed).toBe(false);

    await expect(
      assertBatchAccess(db, principal, "batch-1", "read")
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("allows an admin to write, with requiresAudit", async () => {
    const principal: Principal = { userId: adminId, role: "admin" };
    const result = await assertBatchAccess(db, principal, "batch-1", "write");
    expect(result.requiresAudit).toBe(true);
  });
});
