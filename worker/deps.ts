/**
 * Worker dependency container (Stage 4 worker; production-gap-closure
 * "Shared core boundary" + stage-1-preflight §3 Worker Artifact Contract).
 *
 * The worker is composed entirely from injected adapters so the same processing
 * logic runs against:
 *   - the offline test harness: PGlite + fake storage + memory queue + stub model
 *   - production: `pg` Pool + Vercel Blob + Postgres-outbox queue + OpenAI
 *
 * `buildProductionDeps` is the production composition root. It is typecheck-only
 * — never invoked by the offline test suite (which constructs its own fakes) —
 * and reads every provider choice from the env contract documented in
 * `docs/designs/stage-1-preflight.md` §3.
 *
 * Worker-safe: imports only the shared core / adapters; NO next/react imports.
 */
import type { DbClient } from "@/lib/db/client";
import type { QueueAdapter } from "@/lib/adapters/queue/types";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import type { ModelAdapter } from "@/lib/adapters/model/types";

import { createPgPool } from "@/lib/db/pg";
import { createPostgresOutboxQueue } from "@/lib/adapters/queue/postgresOutbox";
import { createVercelBlobStorage } from "@/lib/adapters/storage/vercelBlob";
import { createOpenAIModel } from "@/lib/adapters/model/openai";

/** Everything `processCaseJob` / the poll loop need, injected for testability. */
export interface WorkerDeps {
  db: DbClient;
  queue: QueueAdapter;
  storage: StorageAdapter;
  model: ModelAdapter;
  /** Injected clock (epoch ms). Defaults to `Date.now`. Tests drive it. */
  now?: () => number;
  /** Bounded-attempt budget before a job is dead-lettered. Default 3. */
  maxAttempts?: number;
}

/** Default bounded-attempt budget (plan: "bounded retries", "Poison jobs"). */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Production composition root. Builds the real adapters from environment config
 * per the stage-1 preflight env contract. Constructs nothing lazily-avoidable:
 * the OpenAI client and `pg` pool initialize on first use, so importing this
 * module is cheap. Typecheck-only — not run in tests.
 */
export function buildProductionDeps(): WorkerDeps {
  return {
    db: createPgPool(process.env.DATABASE_URL),
    queue: createPostgresOutboxQueue(createPgPool(process.env.DATABASE_URL)),
    storage: createVercelBlobStorage(),
    model: createOpenAIModel(),
    maxAttempts: process.env.WORKER_MAX_ATTEMPTS
      ? Number(process.env.WORKER_MAX_ATTEMPTS)
      : DEFAULT_MAX_ATTEMPTS,
  };
}
