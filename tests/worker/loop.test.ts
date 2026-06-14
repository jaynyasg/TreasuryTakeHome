import { afterEach, describe, expect, it } from "vitest";
import type { DbClient } from "@/lib/db/client";
import type { QueueJob } from "@/lib/adapters/queue/types";
import type { ModelAdapter } from "@/lib/adapters/model/types";

import { createStubModel } from "@/lib/adapters/model/stub";
import { getCase } from "@/lib/db/repositories/cases";

import { runOnce, runWorkerLoop } from "@/worker/loop";
import { createHealthState } from "@/worker/health";
import type { CaseOutcome } from "@/worker/processCase";
import {
  buildHarness,
  seedCase,
  enqueueCaseJob,
  CLEAN_MATCH_APPLICATION,
} from "./harness";

describe("runOnce", () => {
  let db: DbClient | null = null;
  afterEach(async () => {
    if (db) await db.close();
    db = null;
  });

  it("claims and processes a mixed batch, returning the right outcomes", async () => {
    const h = await buildHarness();
    db = h.db;

    // A clean-match case and a mismatch case.
    const clean = await seedCase(h.db, h.storage);
    const mismatch = await seedCase(h.db, h.storage, {
      application: { ...CLEAN_MATCH_APPLICATION, brandName: "DIFFERENT BRAND CO" },
    });
    await enqueueCaseJob(h.queue, clean.caseId);
    await enqueueCaseJob(h.queue, mismatch.caseId);

    const outcomes = await runOnce(h.deps, { max: 10 });
    expect(outcomes).toHaveLength(2);

    const byCase = new Map(
      outcomes
        .filter((o): o is Extract<CaseOutcome, { caseId: string }> => "caseId" in o)
        .map((o) => [o.caseId, o])
    );
    expect(byCase.get(clean.caseId)?.kind).toBe("scored");
    expect(byCase.get(mismatch.caseId)?.kind).toBe("scored");

    expect((await getCase(h.db, clean.caseId))?.status).toBe("clean_match");
    expect((await getCase(h.db, mismatch.caseId))?.status).toBe("has_mismatches");

    // Both jobs acked.
    expect(await h.queue.stats()).toEqual({ ready: 0, inflight: 0, deadLetter: 0 });
  });

  it("contains a throwing job so the rest of the batch still processes (isolation)", async () => {
    // A model that THROWS (an unexpected crash, not a graceful ok:false) for the
    // poison case's label bytes, and succeeds for everyone else. The poison
    // case stores a distinctive first byte the model routes on. This proves the
    // loop's per-job try/catch: a thrown job is contained as 'failed' while the
    // sibling good job still scores.
    const POISON_MARKER = 0xff;
    const goodLabel = createStubModel(); // DEFAULT_STUB_LABEL
    const routingModel: ModelAdapter = {
      async extractLabel(input) {
        const firstByte = Buffer.from(input.imageBase64, "base64")[0];
        if (firstByte === POISON_MARKER) {
          throw new Error("boom: model client exploded");
        }
        return goodLabel.extractLabel(input);
      },
      extractApplication: (input) => goodLabel.extractApplication(input),
    };

    const h = await buildHarness({ model: routingModel });
    db = h.db;
    const good = await seedCase(h.db, h.storage);
    const poison = await seedCase(h.db, h.storage);
    // Overwrite the poison case's stored label bytes with the marker byte.
    if (poison.labelObjectKey) {
      await h.storage.put(poison.labelObjectKey, new Uint8Array([POISON_MARKER, 0x00]), {
        contentType: "image/png",
      });
    }
    await enqueueCaseJob(h.queue, good.caseId);
    await enqueueCaseJob(h.queue, poison.caseId);

    const outcomes = await runOnce(h.deps, { max: 10 });
    expect(outcomes).toHaveLength(2);

    const byCase = new Map(
      outcomes
        .filter((o): o is Extract<CaseOutcome, { caseId: string }> => "caseId" in o)
        .map((o) => [o.caseId, o])
    );
    // The good job still scored despite its sibling throwing.
    expect(byCase.get(good.caseId)?.kind).toBe("scored");
    expect((await getCase(h.db, good.caseId))?.status).toBe("clean_match");
    // The poison job was contained as a 'failed' outcome, not an abort.
    expect(byCase.get(poison.caseId)?.kind).toBe("failed");
  });
});

describe("runWorkerLoop", () => {
  let db: DbClient | null = null;
  afterEach(async () => {
    if (db) await db.close();
    db = null;
  });

  it("polls until aborted and records health", async () => {
    const h = await buildHarness();
    db = h.db;
    const { caseId } = await seedCase(h.db, h.storage);
    await enqueueCaseJob(h.queue, caseId);

    const health = createHealthState({ now: h.clock.now });
    const controller = new AbortController();

    // Run the loop; abort it after the first successful poll drains the queue.
    const loop = runWorkerLoop(h.deps, {
      intervalMs: 5,
      max: 10,
      signal: controller.signal,
      health,
    });

    // Give the loop a few real ticks to claim + process, then stop it.
    await new Promise((r) => setTimeout(r, 50));
    controller.abort();
    await loop;

    expect((await getCase(h.db, caseId))?.status).toBe("clean_match");
    const snap = health.snapshot();
    expect(snap.processed).toBeGreaterThanOrEqual(1);
    expect(snap.lastPollAt).not.toBeNull();
  });
});
