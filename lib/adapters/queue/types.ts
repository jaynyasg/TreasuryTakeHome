/**
 * Queue adapter contract (Stage 4: durable per-case jobs).
 *
 * One typed seam over the queue backbone so worker logic never depends on a
 * concrete provider (plan "Temporal Decisions" → Queue backbone; stage-1
 * preflight §2 Queue). Vercel Queues (beta, poll mode) is the first provider;
 * a Postgres-backed outbox is the named fallback. Both implement THIS interface
 * and must pass the shared contract tests (`contractTest.ts`).
 *
 * Semantics the interface promises (proven by `runQueueContract`):
 *   - **Idempotent intake.** `enqueue` is keyed by `idempotencyKey`; a repeat
 *     key is a no-op (`enqueued:false`) and never creates a duplicate job. This
 *     is what makes refresh/retry/double-submit at the intake boundary safe
 *     (plan "Idempotent intake").
 *   - **Poll mode.** Consumers off-Vercel `claim()` work rather than receive
 *     pushes (preflight: worker host is off-Vercel → poll mode).
 *   - **Visibility timeout.** A claimed job is invisible to other claimants
 *     until its visibility window lapses; if never acked it reappears, giving
 *     at-least-once delivery. Worker idempotency (case state machine) makes the
 *     duplicate harmless.
 *   - **Bounded retry → dead-letter.** `retry` re-arms a job with backoff and
 *     bumps its attempt count; `deadLetter` parks a poison job out of the ready
 *     set with its failure reason preserved for admin replay (plan "Poison
 *     jobs").
 */

/** A unit of work handed to a poll-mode consumer by `claim()`. */
export interface QueueJob {
  /** App-minted job id (propagated through logs/DB rows for traceability). */
  id: string;
  /** Job kind, e.g. the worker stage it routes to. */
  type: string;
  /** Opaque job body. Validated at the worker seam, never trusted by shape. */
  payload: unknown;
  /** Dedup key for idempotent intake (case id + processing-attempt scope). */
  idempotencyKey: string;
  /** Delivery count so far; lets the worker enforce a bounded-attempt budget. */
  attempts: number;
}

/** Input accepted by {@link QueueAdapter.enqueue}. `attempts` is owned by the
 *  adapter (starts at 0), so callers do not supply it. */
export interface EnqueueInput {
  id: string;
  type: string;
  payload: unknown;
  idempotencyKey: string;
}

/** Options for a poll-mode {@link QueueAdapter.claim}. */
export interface ClaimOptions {
  /** Maximum number of jobs to claim in one poll. */
  max: number;
  /** How long claimed jobs stay invisible before reappearing if not acked. */
  visibilityTimeoutMs: number;
}

/** Counts surfaced to the operations console (queue depth / health). */
export interface QueueStats {
  /** Jobs claimable right now (state=ready AND visible). */
  ready: number;
  /** Jobs currently claimed and inside their visibility window. */
  inflight: number;
  /** Poison jobs parked for admin replay. */
  deadLetter: number;
}

/**
 * The provider-agnostic queue seam. Every method is async because real
 * providers are remote; the in-memory adapter resolves synchronously.
 */
export interface QueueAdapter {
  /**
   * Enqueue a job. Idempotent on `idempotencyKey`: the first call for a key
   * enqueues (`enqueued:true`); any later call with the same key is a no-op
   * (`enqueued:false`) and does NOT create a duplicate job.
   */
  enqueue(job: EnqueueInput): Promise<{ enqueued: boolean }>;
  /**
   * Poll-mode claim: atomically take up to `max` ready+visible jobs, mark them
   * in-flight, and hide them for `visibilityTimeoutMs`. Returns the claimed
   * jobs (possibly fewer than `max`, or empty).
   */
  claim(opts: ClaimOptions): Promise<QueueJob[]>;
  /** Acknowledge successful processing; the job leaves the queue for good. */
  ack(jobId: string): Promise<void>;
  /**
   * Re-arm a failed-but-retryable job: increment its attempt count and make it
   * claimable again after `delayMs` (backoff).
   */
  retry(jobId: string, delayMs: number): Promise<void>;
  /** Park a poison job in dead-letter with `reason`, out of the ready set. */
  deadLetter(jobId: string, reason: string): Promise<void>;
  /** Snapshot of queue depth by state for ops/health views. */
  stats(): Promise<QueueStats>;
}
