/**
 * Configurable SLO / concurrency / spend budgets (plan
 * `docs/designs/production-gap-closure.md`):
 *
 *   - "Concurrency budget": configurable per-stage limits for intake
 *     finalization, extraction/model calls, scoring, evidence storage, export
 *     generation, and replay.
 *   - "Spend and concurrency budgets": model-call concurrency and daily/batch
 *     spend caps must be configurable before enabling 300-case durable batches.
 *   - "Latency targets": single-case verification <=5s p50; 300-case manifest
 *     preflight <=10s; first durable result <=60s; 50-case batch <=10 min;
 *     300-case batch <=45 min (staging stub/live-limited; tune after real
 *     measurements).
 *
 * One typed source of truth, resolved from env with documented defaults. Pure +
 * framework-free (NO React/Next/I/O): {@link resolveLimits} takes an injectable
 * `env` so the worker, API routes, and tests all read the same budgets. `LIMITS`
 * is the process-default resolution. Worker-safe.
 */

/** The injectable environment shape (a subset of `process.env`). */
export type LimitsEnv = Record<string, string | undefined>;

/**
 * Per-stage concurrency caps (max simultaneous units of work per pipeline
 * stage). Plan "Concurrency budget". `model` is also the model-call concurrency
 * cap from "Spend and concurrency budgets".
 */
export interface StageConcurrency {
  /** Intake finalization (manifest → batch/case creation + enqueue). */
  intake: number;
  /** Extraction / model (LLM) calls — the spend-sensitive stage. */
  model: number;
  /** Deterministic scoring. */
  scoring: number;
  /** Evidence (crop) storage. */
  evidence: number;
  /** Export artifact generation. */
  export: number;
  /** Admin replay of dead-letter / failed cases. */
  replay: number;
}

/** Spend caps in USD (plan "Spend and concurrency budgets"). */
export interface SpendCaps {
  /** Daily model-spend cap across all batches. */
  dailyUsd: number;
  /** Per-batch model-spend cap. */
  perBatchUsd: number;
}

/**
 * Prototype SLO targets (plan "Latency targets"). Latencies are milliseconds;
 * documented as targets, not enforced gates — tune after real measurement.
 */
export interface SloTargets {
  /** Single-case verification p50 (<=5s when provider-healthy). */
  singleCaseP50Ms: number;
  /** 300-case manifest preflight (<=10s). */
  preflight300Ms: number;
  /** First durable case result (<=60s). */
  firstDurableResultMs: number;
  /** 50-case batch completion (<=10 min). */
  batch50CompletionMs: number;
  /** 300-case batch completion (<=45 min). */
  batch300CompletionMs: number;
}

/** The fully-resolved budget set. */
export interface Limits {
  concurrency: StageConcurrency;
  spend: SpendCaps;
  slo: SloTargets;
}

/**
 * Documented defaults (used when the matching env var is unset/invalid). These
 * are the conservative prototype budgets from the plan; raise via env before a
 * 300-case durable run. SLO values come directly from the plan's "Latency
 * targets" item.
 */
export const DEFAULT_LIMITS: Limits = {
  concurrency: {
    intake: 4,
    // Model concurrency stays low — it is the spend- and rate-limit-sensitive
    // stage and the cap referenced by "Spend and concurrency budgets".
    model: 4,
    scoring: 8,
    evidence: 8,
    export: 2,
    replay: 2,
  },
  spend: {
    dailyUsd: 50,
    perBatchUsd: 20,
  },
  slo: {
    singleCaseP50Ms: 5_000,
    preflight300Ms: 10_000,
    firstDurableResultMs: 60_000,
    batch50CompletionMs: 10 * 60_000,
    batch300CompletionMs: 45 * 60_000,
  },
};

/** Env var name for each overridable budget (single source of mapping). */
export const LIMIT_ENV_VAR = {
  intakeConcurrency: "INTAKE_CONCURRENCY",
  modelConcurrency: "MODEL_CONCURRENCY",
  scoringConcurrency: "SCORING_CONCURRENCY",
  evidenceConcurrency: "EVIDENCE_CONCURRENCY",
  exportConcurrency: "EXPORT_CONCURRENCY",
  replayConcurrency: "REPLAY_CONCURRENCY",
  dailySpendUsd: "DAILY_SPEND_CAP_USD",
  perBatchSpendUsd: "PER_BATCH_SPEND_CAP_USD",
} as const;

/**
 * Parse a positive integer env override. Returns `fallback` when unset, blank,
 * non-numeric, non-finite, or <= 0 (a zero/negative concurrency cap would stall
 * the pipeline, so it is treated as "unset").
 */
function envPositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/**
 * Parse a positive (>= 0) number env override for spend caps. Returns `fallback`
 * when unset, blank, non-numeric, non-finite, or negative. Zero IS allowed —
 * a `0` cap means "no spend permitted" (a valid hard brake).
 */
function envNonNegativeNumber(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Resolve {@link Limits} from `env` (defaulting to `process.env`) layered over
 * {@link DEFAULT_LIMITS}. SLO targets are fixed defaults (not env-overridable in
 * this prototype); concurrency caps and spend caps are env-overridable.
 */
export function resolveLimits(env: LimitsEnv = process.env): Limits {
  return {
    concurrency: {
      intake: envPositiveInt(
        env[LIMIT_ENV_VAR.intakeConcurrency],
        DEFAULT_LIMITS.concurrency.intake,
      ),
      model: envPositiveInt(
        env[LIMIT_ENV_VAR.modelConcurrency],
        DEFAULT_LIMITS.concurrency.model,
      ),
      scoring: envPositiveInt(
        env[LIMIT_ENV_VAR.scoringConcurrency],
        DEFAULT_LIMITS.concurrency.scoring,
      ),
      evidence: envPositiveInt(
        env[LIMIT_ENV_VAR.evidenceConcurrency],
        DEFAULT_LIMITS.concurrency.evidence,
      ),
      export: envPositiveInt(
        env[LIMIT_ENV_VAR.exportConcurrency],
        DEFAULT_LIMITS.concurrency.export,
      ),
      replay: envPositiveInt(
        env[LIMIT_ENV_VAR.replayConcurrency],
        DEFAULT_LIMITS.concurrency.replay,
      ),
    },
    spend: {
      dailyUsd: envNonNegativeNumber(
        env[LIMIT_ENV_VAR.dailySpendUsd],
        DEFAULT_LIMITS.spend.dailyUsd,
      ),
      perBatchUsd: envNonNegativeNumber(
        env[LIMIT_ENV_VAR.perBatchSpendUsd],
        DEFAULT_LIMITS.spend.perBatchUsd,
      ),
    },
    // SLO targets are fixed prototype targets (plan "Latency targets").
    slo: { ...DEFAULT_LIMITS.slo },
  };
}

/** The process-default resolved limits (reads `process.env` at access time). */
export const LIMITS: Limits = resolveLimits();

/** Outcome of a spend check against a cap. */
export interface SpendCheck {
  /** True while spend remains strictly under the cap. */
  ok: boolean;
  /** True once spend has reached or passed the cap (the inverse of `ok`). */
  exceeded: boolean;
  /** Remaining headroom before the cap (clamped at 0). */
  remainingUsd: number;
}

/**
 * Check spend against a cap. The cap is INCLUSIVE: reaching the cap exactly
 * counts as exceeded (`ok` is false at `spentUsd === cap`), so a stage stops
 * before going over. Non-finite/negative inputs are treated as 0.
 */
export function checkSpend(spentUsd: number, cap: number): SpendCheck {
  const spent = Number.isFinite(spentUsd) && spentUsd > 0 ? spentUsd : 0;
  const ceiling = Number.isFinite(cap) && cap > 0 ? cap : 0;
  const exceeded = spent >= ceiling;
  return {
    ok: !exceeded,
    exceeded,
    remainingUsd: Math.max(0, ceiling - spent),
  };
}
