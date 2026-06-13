/**
 * Worker entrypoint (stage-1-preflight §3 Worker Artifact Contract).
 *
 * Composes production deps, starts the poll loop, and exposes a minimal
 * `GET /healthz` HTTP server for host liveness/readiness probes and the
 * ops-console heartbeat. Reads `WORKER_POLL_INTERVAL_MS` and `WORKER_PORT`
 * (a.k.a. `PORT`) from the environment.
 *
 * Typecheck-only — never imported by the offline test suite. The loop and
 * health logic it wires together ARE tested (tests/worker/*).
 *
 * Worker-safe: uses node:http, shared core, and adapters; NO next/react.
 */
import { createServer } from "node:http";
import { buildProductionDeps } from "./deps";
import { runWorkerLoop } from "./loop";
import { createHealthState } from "./health";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

async function main(): Promise<void> {
  const deps = buildProductionDeps();
  const health = createHealthState();
  const controller = new AbortController();

  const port = envInt("WORKER_PORT", envInt("PORT", 8080));
  const intervalMs = envInt("WORKER_POLL_INTERVAL_MS", 2000);

  // Health server: 200 when ok/starting, 503 when unhealthy.
  const server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/healthz") {
      const snap = health.snapshot();
      const code = snap.status === "unhealthy" ? 503 : 200;
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(snap));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(port, () => {
    console.log(`[worker] health server listening on :${port}/healthz`);
  });

  // Graceful shutdown: stop polling, drain, close the health server.
  const shutdown = (signal: string): void => {
    console.log(`[worker] ${signal} received; shutting down`);
    controller.abort();
    server.close(() => {
      void deps.db.close().finally(() => process.exit(0));
    });
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  console.log(`[worker] poll loop starting (interval ${intervalMs}ms)`);
  await runWorkerLoop(deps, {
    intervalMs,
    signal: controller.signal,
    health,
  });
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
