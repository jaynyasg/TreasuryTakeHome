/**
 * In-memory {@link QueueAdapter} — the fake/local adapter for tests and local
 * worker runs (plan "Adapter contract tests": fake and real adapters share
 * behavior-level tests). No I/O; deterministic.
 *
 * Determinism: time is injected. Tests pass a controllable `now()` so the
 * visibility window and retry backoff can be advanced explicitly instead of
 * sleeping or depending on wall-clock `Date.now()` nondeterminism. Defaults to
 * `Date.now` for real local runs.
 *
 * This adapter satisfies exactly the same semantics as the Postgres outbox
 * adapter (proven by `runQueueContract` running against both): idempotent
 * enqueue, poll-mode claim with a visibility window, ack, delayed retry, and
 * dead-letter.
 */
import type {
  ClaimOptions,
  EnqueueInput,
  QueueAdapter,
  QueueJob,
  QueueStats,
} from "./types";

type JobState = "ready" | "inflight" | "done" | "dead_letter";

/** Internal record. Mirrors the `queue_jobs` row shape so the two adapters stay
 *  semantically aligned. `visibleAt` is an epoch-ms timestamp from injected
 *  `now`. */
interface MemoryJob {
  id: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
  state: JobState;
  attempts: number;
  visibleAt: number;
  claimedAt: number | null;
  deadLetterReason: string | null;
}

/**
 * Build an in-memory queue adapter.
 *
 * @param now Injected clock returning epoch milliseconds; defaults to
 *   `Date.now`. Tests advance a mutable counter through this to drive the
 *   visibility window and retry delay deterministically.
 */
export function createMemoryQueue(now: () => number = Date.now): QueueAdapter {
  // Keyed by job id (the unit a claim/ack/retry/deadLetter targets).
  const jobs = new Map<string, MemoryJob>();
  // Seen idempotency keys → no duplicate enqueue for a repeated key.
  const seenKeys = new Set<string>();

  function toQueueJob(job: MemoryJob): QueueJob {
    return {
      id: job.id,
      type: job.type,
      payload: job.payload,
      idempotencyKey: job.idempotencyKey,
      attempts: job.attempts,
    };
  }

  return {
    async enqueue(job: EnqueueInput): Promise<{ enqueued: boolean }> {
      // Idempotent intake: a repeated idempotency key is a no-op.
      if (seenKeys.has(job.idempotencyKey)) return { enqueued: false };
      seenKeys.add(job.idempotencyKey);
      jobs.set(job.id, {
        id: job.id,
        type: job.type,
        payload: job.payload,
        idempotencyKey: job.idempotencyKey,
        state: "ready",
        attempts: 0,
        visibleAt: now(),
        claimedAt: null,
        deadLetterReason: null,
      });
      return { enqueued: true };
    },

    async claim(opts: ClaimOptions): Promise<QueueJob[]> {
      const at = now();
      // Claimable = visible AND (ready, OR in-flight whose visibility lapsed
      // without an ack => at-least-once redelivery). Order by visible_at for
      // stable, fair delivery (matches the outbox ORDER BY visible_at).
      const claimable = [...jobs.values()]
        .filter(
          (j) =>
            j.visibleAt <= at &&
            (j.state === "ready" || j.state === "inflight")
        )
        .sort((a, b) => a.visibleAt - b.visibleAt)
        .slice(0, opts.max);

      const claimed: QueueJob[] = [];
      for (const job of claimable) {
        job.state = "inflight";
        job.attempts += 1;
        job.claimedAt = at;
        // Hide for the visibility window; reappears (state stays inflight but
        // becomes visible again) if not acked. The claim filter below restores
        // expired in-flight jobs to claimable.
        job.visibleAt = at + opts.visibilityTimeoutMs;
        claimed.push(toQueueJob(job));
      }
      return claimed;
    },

    async ack(jobId: string): Promise<void> {
      const job = jobs.get(jobId);
      if (!job) return;
      job.state = "done";
      job.claimedAt = null;
    },

    async retry(jobId: string, delayMs: number): Promise<void> {
      const job = jobs.get(jobId);
      if (!job) return;
      // attempts already incremented at claim time; re-arm with backoff.
      job.state = "ready";
      job.claimedAt = null;
      job.visibleAt = now() + delayMs;
    },

    async deadLetter(jobId: string, reason: string): Promise<void> {
      const job = jobs.get(jobId);
      if (!job) return;
      job.state = "dead_letter";
      job.claimedAt = null;
      job.deadLetterReason = reason;
    },

    async stats(): Promise<QueueStats> {
      const at = now();
      let ready = 0;
      let inflight = 0;
      let deadLetter = 0;
      for (const job of jobs.values()) {
        if (job.state === "dead_letter") {
          deadLetter += 1;
        } else if (job.state === "ready" && job.visibleAt <= at) {
          ready += 1;
        } else if (job.state === "inflight" && job.visibleAt > at) {
          // Still inside its visibility window => genuinely in flight.
          inflight += 1;
        } else if (job.state === "inflight" && job.visibleAt <= at) {
          // Visibility lapsed without an ack: it is claimable again => ready.
          ready += 1;
        }
      }
      return { ready, inflight, deadLetter };
    },
  };
}
