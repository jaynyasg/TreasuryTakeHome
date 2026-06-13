/**
 * Poll-mode worker loop (stage-1-preflight §2: the worker runs off-Vercel and
 * CLAIMS work rather than receiving pushes).
 *
 * `runOnce` claims up to `max` jobs and processes each. A thrown error in one
 * job is caught and recorded so it cannot abort the rest of the batch (plan
 * Error Flow: "one bad job can't kill the loop"). `runWorkerLoop` polls
 * `runOnce` on an interval until its AbortSignal fires.
 *
 * Worker-safe: shared core + adapters only; no next/react.
 */
import type { WorkerDeps } from "./deps";
import { processCaseJob, type CaseOutcome } from "./processCase";
import type { HealthState } from "./health";
import { isWorkerProcessingDisabled } from "@/lib/flags";

/** How long a claimed job stays invisible before redelivery if not acked. */
const DEFAULT_VISIBILITY_TIMEOUT_MS = 30_000;

export interface RunOnceOptions {
  /** Max jobs to claim in this poll. */
  max: number;
  /** Visibility window for claimed jobs (default 30s). */
  visibilityTimeoutMs?: number;
}

/**
 * Claim up to `opts.max` ready jobs and process each. Returns one outcome per
 * job in claim order. Per-job errors are caught and returned as a 'failed'
 * outcome so a single bad job never aborts the others; the job stays in-flight
 * and will redeliver after its visibility window for another bounded attempt.
 */
export async function runOnce(
  deps: WorkerDeps,
  opts: RunOnceOptions
): Promise<CaseOutcome[]> {
  const visibilityTimeoutMs =
    opts.visibilityTimeoutMs ?? DEFAULT_VISIBILITY_TIMEOUT_MS;
  const jobs = await deps.queue.claim({ max: opts.max, visibilityTimeoutMs });

  const outcomes: CaseOutcome[] = [];
  for (const job of jobs) {
    try {
      outcomes.push(await processCaseJob(deps, job));
    } catch (err) {
      // Containment: never let one job's unexpected throw abort the batch. The
      // job is left in-flight (not acked) so the queue redelivers it for a
      // bounded retry once its visibility window lapses.
      const reason = err instanceof Error ? err.message : "unexpected job error";
      outcomes.push({ kind: "failed", caseId: jobIdOf(job), reason });
    }
  }
  return outcomes;
}

function jobIdOf(job: { payload: unknown; id: string }): string {
  const payload = job.payload as { caseId?: unknown } | null;
  return typeof payload?.caseId === "string" ? payload.caseId : job.id;
}

export interface WorkerLoopOptions {
  /** Poll interval in ms between `runOnce` calls. */
  intervalMs: number;
  /** Max jobs claimed per poll (default 10 — demo-scale batch). */
  max?: number;
  /** Visibility window passed to each claim. */
  visibilityTimeoutMs?: number;
  /** Abort to stop the loop (e.g. SIGTERM handler). */
  signal?: AbortSignal;
  /** Optional health state updated each poll for `/healthz`. */
  health?: HealthState;
}

/**
 * Run the poll loop until `signal` aborts. Each iteration calls `runOnce`,
 * records health, and waits `intervalMs`. Loop-level errors (e.g. the queue
 * provider is unreachable) are caught, recorded on health, and the loop
 * continues — a transient provider outage must not crash the worker.
 */
export async function runWorkerLoop(
  deps: WorkerDeps,
  opts: WorkerLoopOptions
): Promise<void> {
  const now = deps.now ?? Date.now;
  const max = opts.max ?? 10;

  while (!opts.signal?.aborted) {
    try {
      opts.health?.markPoll(now());
      // Runtime kill switch (plan "Operational brakes"): when worker processing
      // is disabled, keep the loop + heartbeat alive but claim/process nothing,
      // so in-flight jobs drain and queued work waits rather than failing.
      if (isWorkerProcessingDisabled()) {
        opts.health?.markProcessed([]);
      } else {
        const outcomes = await runOnce(deps, {
          max,
          visibilityTimeoutMs: opts.visibilityTimeoutMs,
        });
        opts.health?.markProcessed(outcomes);
      }
    } catch (err) {
      opts.health?.markError(err instanceof Error ? err.message : String(err));
    }
    if (opts.signal?.aborted) break;
    await delay(opts.intervalMs, opts.signal);
  }
}

/** Sleep `ms`, resolving early if `signal` aborts (so shutdown is prompt). */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
