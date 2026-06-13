/**
 * Tiny structured logger (plan `docs/designs/production-gap-closure.md`
 * "Traceability" + Observability review §8: structured logs with trace ids
 * propagated across web, queue, worker, database, storage, model calls, and
 * exports).
 *
 * Emits single-line JSON `{ level, msg, ...fields }` so log aggregation can
 * filter by `traceId`/`batchId`/`caseId`/etc. `child(fields)` returns a new
 * logger with merged context, the natural way to attach a {@link TraceContext}
 * (spread its fields in) once per request/job and have every line carry the
 * correlation ids.
 *
 * Deterministic + injectable: the output `sink` and the timestamp `now` are both
 * injectable. NO timestamp is generated internally unless a `now` is provided,
 * so tests produce byte-stable output. Framework-free (NO React/Next); the
 * default sink is `console`, which is worker- and edge-safe.
 */

/** Severity levels emitted by the logger. */
export type LogLevel = "info" | "warn" | "error";

/** Structured fields attached to a log line (e.g. spread a TraceContext here). */
export type LogFields = Record<string, unknown>;

/** The shape of one emitted record (before JSON serialization). */
export interface LogRecord {
  level: LogLevel;
  msg: string;
  /** Epoch ms — present ONLY when a `now` was injected (deterministic tests). */
  time?: number;
  /** Merged base context + per-call fields. */
  [key: string]: unknown;
}

/**
 * A sink receives the serialized JSON line plus its level (so a sink can route
 * warn/error to stderr). Injectable for tests; the default writes to console.
 */
export type LogSink = (line: string, level: LogLevel) => void;

/** The structured logger surface. */
export interface Logger {
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** A new logger with `fields` merged onto this logger's base context. */
  child(fields: LogFields): Logger;
}

/** Options for {@link createLogger}. */
export interface LoggerOptions {
  /** Where lines go. Defaults to {@link consoleSink}. */
  sink?: LogSink;
  /**
   * Clock for the `time` field. When omitted, NO `time` field is emitted
   * (keeps output deterministic for tests). Provide `Date.now` in production.
   */
  now?: () => number;
}

/**
 * Default sink: single-line JSON via `console`. `warn`/`error` go to
 * `console.error` (stderr), `info` to `console.log` (stdout), matching the
 * convention that diagnostics are separable from normal output.
 */
export const consoleSink: LogSink = (line, level) => {
  if (level === "info") {
    console.log(line);
  } else {
    console.error(line);
  }
};

/**
 * Create a structured logger. `base` fields are included on every line (merged
 * under per-call fields, which win on conflict). The emitted record always has
 * `level` and `msg` first, then base+call fields; `time` appears only when
 * `now` is injected.
 */
export function createLogger(
  base: LogFields = {},
  options: LoggerOptions = {},
): Logger {
  const sink = options.sink ?? consoleSink;
  const now = options.now;

  function emit(level: LogLevel, msg: string, fields?: LogFields): void {
    const record: LogRecord = { level, msg, ...base, ...fields };
    if (now !== undefined) record.time = now();
    sink(JSON.stringify(record), level);
  }

  return {
    info: (msg, fields) => emit("info", msg, fields),
    warn: (msg, fields) => emit("warn", msg, fields),
    error: (msg, fields) => emit("error", msg, fields),
    child: (fields) => createLogger({ ...base, ...fields }, options),
  };
}
