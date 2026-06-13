import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { DbClient } from "@/lib/db/client";
import { createMemoryQueue } from "@/lib/adapters/queue/memory";
import type { ColaApplication } from "@/lib/contract";
import {
  addManifestEntry,
  createIntakeSession,
  getIntakeByIdempotencyKey,
  IllegalIntakeTransitionError,
  listManifestEntries,
  setIntakeStatus,
} from "@/lib/db/repositories/intake";
import { listBatchesByOwner } from "@/lib/db/repositories/batches";
import { listCasesByBatch } from "@/lib/db/repositories/cases";
import { listCaseFiles } from "@/lib/db/repositories/caseFiles";
import { startBatch } from "@/lib/db/services/startBatch";
import { migratedClient, seedUser } from "./helpers";

/** A minimal valid ColaApplication for a case. */
function app(brand: string): ColaApplication {
  return {
    serialNumber: "12345678901234",
    beverageType: "wine",
    sourceOfProduct: "domestic",
    brandName: brand,
    classType: "RED WINE",
    applicantNameAddress: "ACME Winery, Napa CA",
  };
}

/** Add a complete application+label pair for `caseKey` to a session. */
async function addPair(
  db: DbClient,
  sessionId: string,
  caseKey: string
): Promise<void> {
  await addManifestEntry(db, {
    id: randomUUID(),
    intakeSessionId: sessionId,
    fileName: `${caseKey}_application.pdf`,
    kind: "application",
    caseKey,
    checksum: `app-${caseKey}`,
    sizeBytes: 100,
    contentType: "application/pdf",
    status: "uploaded",
    objectKey: `intake/${sessionId}/${caseKey}_application.pdf`,
  });
  await addManifestEntry(db, {
    id: randomUUID(),
    intakeSessionId: sessionId,
    fileName: `${caseKey}_label.png`,
    kind: "label",
    caseKey,
    checksum: `label-${caseKey}`,
    sizeBytes: 200,
    contentType: "image/png",
    status: "uploaded",
    objectKey: `intake/${sessionId}/${caseKey}_label.png`,
  });
}

describe("intake repository + startBatch service", () => {
  let db: DbClient;
  let ownerId: string;

  beforeEach(async () => {
    db = await migratedClient();
    ownerId = await seedUser(db, "admin");
  }, 30000);

  afterEach(async () => {
    await db.close();
  });

  it("creates an intake session idempotently on the idempotency key", async () => {
    const first = await createIntakeSession(db, {
      id: "sess-1",
      idempotencyKey: "key-abc",
      manifestHash: "hash-1",
    });
    // Same key, different proposed id => returns the SAME existing row.
    const second = await createIntakeSession(db, {
      id: "sess-2",
      idempotencyKey: "key-abc",
    });

    expect(second.id).toBe(first.id);
    expect(second.id).toBe("sess-1");
    const byKey = await getIntakeByIdempotencyKey(db, "key-abc");
    expect(byKey?.id).toBe("sess-1");
  });

  it("enforces the forward-only session lifecycle", async () => {
    await createIntakeSession(db, { id: "sess-1", idempotencyKey: "k1" });
    await setIntakeStatus(db, "sess-1", "preflighting");
    await setIntakeStatus(db, "sess-1", "ready");
    // ready -> draft is illegal.
    await expect(setIntakeStatus(db, "sess-1", "draft")).rejects.toBeInstanceOf(
      IllegalIntakeTransitionError
    );
  });

  it("startBatch creates a batch, queued cases, files, and one job per case", async () => {
    const queue = createMemoryQueue();
    const session = await createIntakeSession(db, {
      id: "sess-1",
      idempotencyKey: "k1",
    });
    await addPair(db, session.id, "c1");
    await addPair(db, session.id, "c2");
    // An incomplete case (label only) must NOT produce a case.
    await addManifestEntry(db, {
      id: randomUUID(),
      intakeSessionId: session.id,
      fileName: "c3_label.png",
      kind: "label",
      caseKey: "c3",
      checksum: "label-c3",
      contentType: "image/png",
      status: "uploaded",
    });

    const result = await startBatch(db, queue, {
      intakeSessionId: session.id,
      ownerUserId: ownerId,
      applications: { c1: app("Acme Red"), c2: app("Acme White") },
    });

    expect(result.caseCount).toBe(2);

    const batches = await listBatchesByOwner(db, ownerId);
    expect(batches).toHaveLength(1);
    expect(batches[0].id).toBe(result.batchId);
    expect(batches[0].status).toBe("processing");

    const cases = await listCasesByBatch(db, result.batchId);
    expect(cases).toHaveLength(2);
    expect(cases.every((c) => c.status === "queued")).toBe(true);

    // Each case has an application + label object-manifest row.
    for (const c of cases) {
      const files = await listCaseFiles(db, c.id);
      expect(files.map((f) => f.kind).sort()).toEqual(["application", "label"]);
    }

    // One job per case is enqueued and claimable.
    const stats = await queue.stats();
    expect(stats.ready).toBe(2);
  });

  it("is idempotent: a double startBatch creates no second batch and no duplicate jobs", async () => {
    const queue = createMemoryQueue();
    const session = await createIntakeSession(db, {
      id: "sess-1",
      idempotencyKey: "k1",
    });
    await addPair(db, session.id, "c1");

    const first = await startBatch(db, queue, {
      intakeSessionId: session.id,
      ownerUserId: ownerId,
      applications: { c1: app("Acme Red") },
    });
    const second = await startBatch(db, queue, {
      intakeSessionId: session.id,
      ownerUserId: ownerId,
      applications: { c1: app("Acme Red") },
    });

    // Same batch id returned; no-op on the replay.
    expect(second.batchId).toBe(first.batchId);
    expect(second.caseCount).toBe(1);

    // Exactly one batch, one case, one job — the replay added nothing.
    expect(await listBatchesByOwner(db, ownerId)).toHaveLength(1);
    expect(await listCasesByBatch(db, first.batchId)).toHaveLength(1);
    const stats = await queue.stats();
    expect(stats.ready + stats.inflight + stats.deadLetter).toBe(1);
  });

  it("lists a session's manifest entries in insertion order", async () => {
    const session = await createIntakeSession(db, {
      id: "sess-1",
      idempotencyKey: "k1",
    });
    await addPair(db, session.id, "c1");
    const entries = await listManifestEntries(db, session.id);
    expect(entries).toHaveLength(2);
    expect(entries[0].kind).toBe("application");
    expect(entries[1].kind).toBe("label");
  });
});
