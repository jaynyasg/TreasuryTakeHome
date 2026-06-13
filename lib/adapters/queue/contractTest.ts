/**
 * Shared behavior-level contract test for {@link QueueAdapter} implementations.
 *
 * Both the in-memory fake and the Postgres outbox fallback must satisfy
 * IDENTICAL semantics (plan "Adapter contract tests"; stage-1 preflight §2:
 * "contract tests ... must pass against both"). Running this one `describe`
 * against each implementation proves they agree on idempotent enqueue, poll-mode
 * claim, the visibility window, ack, delayed retry, and dead-letter.
 *
 * Determinism without sleeping: each implementation supplies a `makeAdapter`
 * that returns the adapter plus an `advanceTime(ms)` hook. The hook moves the
 * adapter's notion of "now" forward so the visibility window and retry backoff
 * can be crossed explicitly. The in-memory adapter advances an injected clock;
 * the outbox advances by rewinding stored `visible_at` timestamps (equivalent to
 * the wall clock moving forward), keeping the suite fully offline and
 * deterministic.
 */
import { describe, expect, it } from "vitest";
import type { QueueAdapter } from "./types";

/** What each adapter implementation must provide to the shared contract. */
export interface QueueContractHarness {
  adapter: QueueAdapter;
  /** Move the adapter's clock forward by `ms` (crosses visibility/backoff). */
  advanceTime: (ms: number) => Promise<void>;
}

/**
 * Register the shared queue contract for one implementation.
 *
 * @param name        Label for the `describe` block (e.g. "memory", "outbox").
 * @param makeAdapter Async factory yielding a fresh, isolated harness per test.
 */
export function runQueueContract(
  name: string,
  makeAdapter: () => Promise<QueueContractHarness>
): void {
  describe(`QueueAdapter contract: ${name}`, () => {
    const VISIBILITY = 30_000;

    it("enqueue then claim returns the job", async () => {
      const { adapter } = await makeAdapter();
      const res = await adapter.enqueue({
        id: "job-1",
        type: "extract",
        payload: { caseId: "case-1" },
        idempotencyKey: "case-1:extract:1",
      });
      expect(res.enqueued).toBe(true);

      const claimed = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe("job-1");
      expect(claimed[0].type).toBe("extract");
      expect(claimed[0].payload).toEqual({ caseId: "case-1" });
      expect(claimed[0].idempotencyKey).toBe("case-1:extract:1");
      expect(claimed[0].attempts).toBe(1);
    });

    it("duplicate idempotencyKey does not double-enqueue", async () => {
      const { adapter } = await makeAdapter();
      const first = await adapter.enqueue({
        id: "job-a",
        type: "extract",
        payload: { n: 1 },
        idempotencyKey: "dupe-key",
      });
      // Same key, different id/payload: must be rejected as a duplicate.
      const second = await adapter.enqueue({
        id: "job-b",
        type: "extract",
        payload: { n: 2 },
        idempotencyKey: "dupe-key",
      });
      expect(first.enqueued).toBe(true);
      expect(second.enqueued).toBe(false);

      // Only one job exists, and it is the first one.
      const claimed = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(claimed).toHaveLength(1);
      expect(claimed[0].id).toBe("job-a");

      const stats = await adapter.stats();
      expect(stats.ready + stats.inflight).toBe(1);
    });

    it("claimed job is invisible to an immediate second claim", async () => {
      const { adapter } = await makeAdapter();
      await adapter.enqueue({
        id: "job-1",
        type: "extract",
        payload: {},
        idempotencyKey: "k1",
      });

      const first = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(first).toHaveLength(1);

      // Within the visibility window: nothing claimable.
      const second = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(second).toHaveLength(0);

      const stats = await adapter.stats();
      expect(stats.inflight).toBe(1);
      expect(stats.ready).toBe(0);
    });

    it("unacked job reappears after the visibility window lapses", async () => {
      const { adapter, advanceTime } = await makeAdapter();
      await adapter.enqueue({
        id: "job-1",
        type: "extract",
        payload: {},
        idempotencyKey: "k1",
      });

      const first = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(first).toHaveLength(1);
      expect(first[0].attempts).toBe(1);

      // Advance past the visibility window without acking => redelivery.
      await advanceTime(VISIBILITY + 1);
      const redelivered = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(redelivered).toHaveLength(1);
      expect(redelivered[0].id).toBe("job-1");
      // Delivery count rose on the second claim (at-least-once delivery).
      expect(redelivered[0].attempts).toBe(2);
    });

    it("ack removes the job from the ready/inflight set", async () => {
      const { adapter, advanceTime } = await makeAdapter();
      await adapter.enqueue({
        id: "job-1",
        type: "extract",
        payload: {},
        idempotencyKey: "k1",
      });
      const claimed = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(claimed).toHaveLength(1);

      await adapter.ack("job-1");

      const stats = await adapter.stats();
      expect(stats.ready).toBe(0);
      expect(stats.inflight).toBe(0);

      // Even after the visibility window, an acked job never reappears.
      await advanceTime(VISIBILITY + 1);
      const after = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(after).toHaveLength(0);
    });

    it("retry makes the job claimable again only after the delay", async () => {
      const { adapter, advanceTime } = await makeAdapter();
      await adapter.enqueue({
        id: "job-1",
        type: "extract",
        payload: {},
        idempotencyKey: "k1",
      });
      const claimed = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(claimed[0].attempts).toBe(1);

      const DELAY = 5_000;
      await adapter.retry("job-1", DELAY);

      // Before the delay elapses: still not claimable.
      const tooSoon = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(tooSoon).toHaveLength(0);

      // After the delay: claimable again, attempts incremented by the reclaim.
      await advanceTime(DELAY + 1);
      const again = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(again).toHaveLength(1);
      expect(again[0].id).toBe("job-1");
      expect(again[0].attempts).toBe(2);
    });

    it("deadLetter moves the job out of ready and into stats.deadLetter", async () => {
      const { adapter, advanceTime } = await makeAdapter();
      await adapter.enqueue({
        id: "job-1",
        type: "extract",
        payload: {},
        idempotencyKey: "k1",
      });
      const claimed = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(claimed).toHaveLength(1);

      await adapter.deadLetter("job-1", "exhausted retries");

      const stats = await adapter.stats();
      expect(stats.deadLetter).toBe(1);
      expect(stats.ready).toBe(0);
      expect(stats.inflight).toBe(0);

      // A dead-lettered job never returns to the claimable set.
      await advanceTime(VISIBILITY + 1);
      const after = await adapter.claim({
        max: 10,
        visibilityTimeoutMs: VISIBILITY,
      });
      expect(after).toHaveLength(0);
    });
  });
}
