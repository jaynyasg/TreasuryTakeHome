import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import {
  appendAuditEvent,
  listAuditEvents,
} from "@/lib/db/repositories/auditEvents";
import { migratedClient, seedUser } from "./helpers";

describe("auditEvents repository", () => {
  let db: DbClient;
  let actorId: string;

  beforeEach(async () => {
    db = await migratedClient();
    actorId = await seedUser(db, "admin");
  });

  afterEach(async () => {
    await db.close();
  });

  it("appends an audit event and reads it back", async () => {
    const event = await appendAuditEvent(db, {
      id: "evt-1",
      actorUserId: actorId,
      action: "batch.status_changed",
      aggregateType: "batch",
      aggregateId: "batch-1",
      beforeSummary: { status: "draft" },
      afterSummary: { status: "preflighting" },
      reason: "intake started",
      traceId: "trace-abc",
    });
    expect(event.action).toBe("batch.status_changed");
    // jsonb round-trips as a parsed object.
    expect(event.after_summary).toEqual({ status: "preflighting" });
  });

  it("lists events for an aggregate in chronological order", async () => {
    await appendAuditEvent(db, {
      id: "evt-2",
      action: "case.created",
      aggregateType: "case",
      aggregateId: "case-9",
    });
    await appendAuditEvent(db, {
      id: "evt-3",
      action: "case.dispositioned",
      aggregateType: "case",
      aggregateId: "case-9",
    });

    const events = await listAuditEvents(db, "case", "case-9");
    expect(events).toHaveLength(2);
    expect(events.map((e) => e.action)).toEqual([
      "case.created",
      "case.dispositioned",
    ]);
  });

  it("scopes listing to the requested aggregate", async () => {
    await appendAuditEvent(db, {
      id: "evt-4",
      action: "batch.created",
      aggregateType: "batch",
      aggregateId: "batch-x",
    });
    const forCase = await listAuditEvents(db, "case", "batch-x");
    expect(forCase).toHaveLength(0);
  });
});
