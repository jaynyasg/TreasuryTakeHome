import { describe, expect, it } from "vitest";
import {
  newTraceId,
  newTraceContext,
  childContext,
  traceHeaders,
  traceContextFromHeaders,
  TRACE_HEADERS,
  type TraceContext,
} from "@/lib/observability/trace";
import {
  createLogger,
  type LogLevel,
  type LogRecord,
} from "@/lib/observability/log";

describe("newTraceId", () => {
  it("returns a URL-safe RFC-4122 v4 uuid", () => {
    const id = newTraceId();
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // URL-safe: no characters needing percent-encoding.
    expect(encodeURIComponent(id)).toBe(id);
  });

  it("is unique across calls (not module-load constant)", () => {
    expect(newTraceId()).not.toBe(newTraceId());
  });
});

describe("newTraceContext", () => {
  it("mints a traceId when none is supplied", () => {
    expect(newTraceContext().traceId).toBeTruthy();
  });

  it("preserves a supplied traceId and drops undefined fields", () => {
    const ctx = newTraceContext({ traceId: "root", batchId: undefined });
    expect(ctx.traceId).toBe("root");
    expect("batchId" in ctx).toBe(false);
  });
});

describe("childContext", () => {
  it("merges immutably without mutating the parent", () => {
    const parent: TraceContext = { traceId: "t1", batchId: "b1" };
    const child = childContext(parent, { caseId: "c1" });
    expect(child).toEqual({ traceId: "t1", batchId: "b1", caseId: "c1" });
    // Parent untouched.
    expect(parent).toEqual({ traceId: "t1", batchId: "b1" });
    expect(child).not.toBe(parent);
  });

  it("lets extra fields win on conflict", () => {
    const parent: TraceContext = { traceId: "t1", caseId: "old" };
    expect(childContext(parent, { caseId: "new" }).caseId).toBe("new");
  });

  it("drops undefined extras rather than overwriting with undefined", () => {
    const parent: TraceContext = { traceId: "t1", batchId: "b1" };
    const child = childContext(parent, { batchId: undefined, jobId: "j1" });
    expect(child.batchId).toBe("b1");
    expect(child.jobId).toBe("j1");
  });
});

describe("traceHeaders <-> traceContextFromHeaders", () => {
  it("round-trips every correlation id", () => {
    const ctx: TraceContext = {
      traceId: "t",
      batchId: "b",
      caseId: "c",
      intakeSessionId: "s",
      jobId: "j",
      attemptId: "a",
      exportId: "e",
    };
    const headers = traceHeaders(ctx);
    expect(headers[TRACE_HEADERS.traceId]).toBe("t");
    expect(traceContextFromHeaders(headers)).toEqual(ctx);
  });

  it("emits only present fields plus the always-present trace id", () => {
    const headers = traceHeaders({ traceId: "t", caseId: "c" });
    expect(headers).toEqual({
      [TRACE_HEADERS.traceId]: "t",
      [TRACE_HEADERS.caseId]: "c",
    });
  });

  it("reads from a Headers-like .get() source", () => {
    const map = new Map<string, string>([
      [TRACE_HEADERS.traceId, "t"],
      [TRACE_HEADERS.jobId, "j"],
    ]);
    const headers = { get: (n: string) => map.get(n) ?? null };
    const ctx = traceContextFromHeaders(headers);
    expect(ctx.traceId).toBe("t");
    expect(ctx.jobId).toBe("j");
  });

  it("mints a fresh trace id when none is present inbound", () => {
    const ctx = traceContextFromHeaders({});
    expect(ctx.traceId).toBeTruthy();
  });
});

describe("createLogger", () => {
  /** A sink that captures emitted lines + levels for assertions. */
  function capture(): {
    lines: Array<{ level: LogLevel; record: LogRecord }>;
    sink: (line: string, level: LogLevel) => void;
  } {
    const lines: Array<{ level: LogLevel; record: LogRecord }> = [];
    return {
      lines,
      sink: (line, level) => lines.push({ level, record: JSON.parse(line) }),
    };
  }

  it("emits a parseable single-line JSON record with level + msg", () => {
    const { lines, sink } = capture();
    createLogger({}, { sink }).info("hello");
    expect(lines).toHaveLength(1);
    expect(lines[0].level).toBe("info");
    expect(lines[0].record).toEqual({ level: "info", msg: "hello" });
  });

  it("merges base context and per-call fields (call wins on conflict)", () => {
    const { lines, sink } = capture();
    const log = createLogger({ traceId: "t", caseId: "base" }, { sink });
    log.warn("oops", { caseId: "call", extra: 1 });
    expect(lines[0].record).toEqual({
      level: "warn",
      msg: "oops",
      traceId: "t",
      caseId: "call",
      extra: 1,
    });
  });

  it("child() merges context and inherits the sink", () => {
    const { lines, sink } = capture();
    const root = createLogger({ traceId: "t" }, { sink });
    const child = root.child({ batchId: "b" });
    child.error("fail", { caseId: "c" });
    expect(lines[0].level).toBe("error");
    expect(lines[0].record).toEqual({
      level: "error",
      msg: "fail",
      traceId: "t",
      batchId: "b",
      caseId: "c",
    });
  });

  it("omits time when no `now` is injected (deterministic)", () => {
    const { lines, sink } = capture();
    createLogger({}, { sink }).info("x");
    expect("time" in lines[0].record).toBe(false);
  });

  it("includes a deterministic time when `now` is injected", () => {
    const { lines, sink } = capture();
    createLogger({}, { sink, now: () => 1234 }).info("x");
    expect(lines[0].record.time).toBe(1234);
  });

  it("routes info to the sink as 'info' and warn/error otherwise", () => {
    const { lines, sink } = capture();
    const log = createLogger({}, { sink });
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(lines.map((l) => l.level)).toEqual(["info", "warn", "error"]);
  });
});
