/**
 * Worker health/readiness state (stage-1-preflight §3: `GET /healthz` →
 * `{status, ..., lastPollAt}` for host liveness probes + the ops-console worker
 * heartbeat).
 *
 * A tiny in-memory state object the poll loop updates each tick. No I/O; the
 * health HTTP server (worker/index.ts) reads `snapshot()`.
 *
 * Worker-safe: pure; no next/react.
 */
import type { CaseOutcome } from "./processCase";

export type HealthStatus = "starting" | "ok" | "unhealthy";

/** The serializable health snapshot returned by `/healthz`. */
export interface HealthSnapshot {
  status: HealthStatus;
  /** Epoch ms of the last completed poll, or null before the first poll. */
  lastPollAt: number | null;
  /** Total job outcomes processed since start. */
  processed: number;
  /** Dead-letters observed since start (surfaced for ops). */
  deadLetters: number;
  /** Last error message recorded by the loop, if any. */
  lastError: string | null;
}

/** Mutable health state with explicit update methods the loop calls. */
export interface HealthState {
  markPoll(at: number): void;
  markProcessed(outcomes: readonly CaseOutcome[]): void;
  markError(message: string): void;
  snapshot(): HealthSnapshot;
}

/**
 * How stale the last poll may be (relative to `now`) before readiness flips to
 * `unhealthy`. Generous default: a few missed poll intervals.
 */
export const DEFAULT_STALE_AFTER_MS = 60_000;

export interface HealthStateOptions {
  now?: () => number;
  staleAfterMs?: number;
}

/** Create a fresh health state (status `starting` until the first poll). */
export function createHealthState(opts: HealthStateOptions = {}): HealthState {
  const now = opts.now ?? Date.now;
  const staleAfterMs = opts.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;

  let lastPollAt: number | null = null;
  let processed = 0;
  let deadLetters = 0;
  let lastError: string | null = null;

  return {
    markPoll(at: number): void {
      lastPollAt = at;
      // A successful poll clears the prior transient error.
      lastError = null;
    },
    markProcessed(outcomes: readonly CaseOutcome[]): void {
      processed += outcomes.length;
      for (const o of outcomes) {
        if (o.kind === "dead_letter") deadLetters += 1;
      }
    },
    markError(message: string): void {
      lastError = message;
    },
    snapshot(): HealthSnapshot {
      return {
        status: deriveStatus(lastPollAt, lastError, now(), staleAfterMs),
        lastPollAt,
        processed,
        deadLetters,
        lastError,
      };
    },
  };
}

/**
 * Stateless readiness derivation: `starting` until the first poll; `unhealthy`
 * when the last poll is stale or an error is outstanding; otherwise `ok`.
 * Exported so a snapshot can be derived/tested without a live state object.
 */
export function deriveStatus(
  lastPollAt: number | null,
  lastError: string | null,
  at: number,
  staleAfterMs: number
): HealthStatus {
  if (lastPollAt === null) return "starting";
  if (lastError !== null) return "unhealthy";
  if (at - lastPollAt > staleAfterMs) return "unhealthy";
  return "ok";
}

/** Convenience: derive a snapshot from a state (mirrors `state.snapshot()`). */
export function healthSnapshot(state: HealthState): HealthSnapshot {
  return state.snapshot();
}
