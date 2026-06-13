/**
 * Trace / correlation id propagation (plan `docs/designs/production-gap-closure.md`
 * "Traceability": propagate batch ID, case ID, intake session ID, job ID,
 * processing attempt ID, export ID, and request trace ID through logs, queue
 * payloads, DB rows, object metadata, and model-call metadata).
 *
 * This is the single place that defines the correlation-id vocabulary so every
 * seam (web request, queue payload, worker attempt, export, log line) carries
 * the same fields. It threads a {@link TraceContext} rather than a bare string,
 * and serializes to/from HTTP headers for the Vercel→worker hops.
 *
 * Pure + framework-free (NO React, NO Next, NO I/O beyond `node:crypto`). The id
 * generator pulls from `node:crypto.randomUUID` at CALL time — never at module
 * load — so importing this module has no side effects and tests can inject ids.
 *
 * Worker-safe: uses `node:crypto` only; no next/react.
 */
import { randomUUID } from "node:crypto";

/**
 * Mint a fresh, URL-safe, stable trace id. Backed by `crypto.randomUUID()`
 * (RFC 4122 v4 — lowercase hex + hyphens, already URL-safe). Generated per call,
 * NOT at module load, so the module stays side-effect-free.
 */
export function newTraceId(): string {
  return randomUUID();
}

/**
 * The correlation-id bag threaded through every seam. `traceId` is always
 * present (the per-request/per-flow root); the remaining aggregate ids attach as
 * the flow descends (batch → case → job → attempt, plus intake session and
 * export). All optional fields are the exact id list from the plan's
 * "Traceability" item.
 */
export interface TraceContext {
  /** Request/flow root id (always present). */
  traceId: string;
  /** Owning batch aggregate id. */
  batchId?: string;
  /** Owning case aggregate id. */
  caseId?: string;
  /** Idempotent intake session id (intake flow). */
  intakeSessionId?: string;
  /** Queue job id. */
  jobId?: string;
  /** Processing attempt id (append-only per replay). */
  attemptId?: string;
  /** Export artifact id. */
  exportId?: string;
}

/**
 * The optional correlation fields (everything except the always-present
 * `traceId`). Used by {@link childContext} to widen a context.
 */
export type TraceFields = Omit<TraceContext, "traceId">;

/** Create a root {@link TraceContext}. Mints a `traceId` when none is given. */
export function newTraceContext(seed: Partial<TraceContext> = {}): TraceContext {
  const { traceId, ...rest } = seed;
  return { traceId: traceId ?? newTraceId(), ...stripUndefined(rest) };
}

/**
 * Immutably merge `extra` onto `ctx`, returning a NEW context (the input is
 * never mutated). `extra` wins on conflict; `traceId` is preserved unless `extra`
 * explicitly overrides it. Drops keys whose value is `undefined` so the bag
 * stays clean for serialization.
 */
export function childContext(
  ctx: TraceContext,
  extra: Partial<TraceContext>,
): TraceContext {
  return { ...ctx, ...stripUndefined(extra) };
}

/** The HTTP header carrying the root trace id across the Vercel→worker hop. */
export const TRACE_ID_HEADER = "x-trace-id" as const;

/** Header names for each optional correlation id (lowercase, `x-`-prefixed). */
export const TRACE_HEADERS = {
  traceId: TRACE_ID_HEADER,
  batchId: "x-batch-id",
  caseId: "x-case-id",
  intakeSessionId: "x-intake-session-id",
  jobId: "x-job-id",
  attemptId: "x-attempt-id",
  exportId: "x-export-id",
} as const;

/**
 * Serialize a {@link TraceContext} to outbound HTTP headers — only the present
 * fields, so the header set stays minimal. Always includes `x-trace-id`.
 */
export function traceHeaders(ctx: TraceContext): Record<string, string> {
  const out: Record<string, string> = { [TRACE_HEADERS.traceId]: ctx.traceId };
  if (ctx.batchId !== undefined) out[TRACE_HEADERS.batchId] = ctx.batchId;
  if (ctx.caseId !== undefined) out[TRACE_HEADERS.caseId] = ctx.caseId;
  if (ctx.intakeSessionId !== undefined) {
    out[TRACE_HEADERS.intakeSessionId] = ctx.intakeSessionId;
  }
  if (ctx.jobId !== undefined) out[TRACE_HEADERS.jobId] = ctx.jobId;
  if (ctx.attemptId !== undefined) out[TRACE_HEADERS.attemptId] = ctx.attemptId;
  if (ctx.exportId !== undefined) out[TRACE_HEADERS.exportId] = ctx.exportId;
  return out;
}

/**
 * A minimal header source: either a `Headers`-like object (with a `.get`) or a
 * plain record. Lets this work with both Fetch `Request.headers` and Node's
 * `IncomingHttpHeaders`.
 */
export type HeaderSource =
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>;

/** Read one header value from either header-source shape (case-insensitive). */
function readHeader(headers: HeaderSource, name: string): string | undefined {
  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get(n: string): string | null }).get(name);
    return value ?? undefined;
  }
  const record = headers as Record<string, string | string[] | undefined>;
  const raw = record[name] ?? record[name.toLowerCase()];
  if (raw === undefined) return undefined;
  return Array.isArray(raw) ? raw[0] : raw;
}

/**
 * Reconstruct a {@link TraceContext} from inbound HTTP headers (the receiving
 * side of {@link traceHeaders}). When no `x-trace-id` is present a fresh root id
 * is minted so the flow is never untraceable. Round-trips every field.
 */
export function traceContextFromHeaders(headers: HeaderSource): TraceContext {
  const traceId = readHeader(headers, TRACE_HEADERS.traceId) ?? newTraceId();
  const ctx: TraceContext = { traceId };
  const batchId = readHeader(headers, TRACE_HEADERS.batchId);
  const caseId = readHeader(headers, TRACE_HEADERS.caseId);
  const intakeSessionId = readHeader(headers, TRACE_HEADERS.intakeSessionId);
  const jobId = readHeader(headers, TRACE_HEADERS.jobId);
  const attemptId = readHeader(headers, TRACE_HEADERS.attemptId);
  const exportId = readHeader(headers, TRACE_HEADERS.exportId);
  if (batchId !== undefined) ctx.batchId = batchId;
  if (caseId !== undefined) ctx.caseId = caseId;
  if (intakeSessionId !== undefined) ctx.intakeSessionId = intakeSessionId;
  if (jobId !== undefined) ctx.jobId = jobId;
  if (attemptId !== undefined) ctx.attemptId = attemptId;
  if (exportId !== undefined) ctx.exportId = exportId;
  return ctx;
}

/** Drop keys whose value is `undefined` (immutable; returns a fresh object). */
function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
