/**
 * Postgres-backed outbox {@link QueueAdapter} — the named fallback queue
 * provider (docs/designs/stage-1-preflight.md §2 Queue). The `queue_jobs` table
 * (migration 0003) IS the queue; the worker polls it in poll mode. It reuses
 * the shared Postgres from Stage 2, so it is the lowest-new-dependency fallback
 * behind the same interface Vercel Queues sits behind.
 *
 * It satisfies exactly the same semantics as the in-memory adapter (proven by
 * `runQueueContract` running against both).
 *
 * PGlite portability of `claim`: PGlite does not support `FOR UPDATE SKIP
 * LOCKED`, so instead of a select-for-update we use the portable guarded-UPDATE
 * pattern — `UPDATE ... WHERE id IN (SELECT ... ORDER BY visible_at LIMIT max)
 * RETURNING *`, run inside a `transaction()`. The inner SELECT picks the
 * ready+visible ids; the UPDATE flips them to in-flight and pushes `visible_at`
 * forward atomically, and `RETURNING` hands back exactly the rows this claim
 * took. Single-statement atomicity inside the transaction is the lock substitute
 * here (sufficient for the demo-scale single-worker poll loop; a real multi-
 * worker Postgres deployment would add `FOR UPDATE SKIP LOCKED`).
 *
 * Idempotency uses the table's UNIQUE(idempotency_key): `INSERT ... ON CONFLICT
 * (idempotency_key) DO NOTHING RETURNING id`. The driver seam exposes only
 * `{ rows }` (no rowCount), so enqueue success is read from whether a row came
 * back — a conflict suppresses the RETURNING row.
 */
import type { DbClient, Queryable } from "@/lib/db/client";
import type {
  ClaimOptions,
  EnqueueInput,
  QueueAdapter,
  QueueJob,
  QueueStats,
} from "./types";

/** Raw `queue_jobs` projection used to build a {@link QueueJob}. */
interface QueueJobRow {
  id: string;
  type: string;
  payload: unknown;
  idempotency_key: string;
  attempts: number;
}

function toQueueJob(row: QueueJobRow): QueueJob {
  return {
    id: row.id,
    type: row.type,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
  };
}

export function createPostgresOutboxQueue(db: DbClient): QueueAdapter {
  return {
    async enqueue(job: EnqueueInput): Promise<{ enqueued: boolean }> {
      // ON CONFLICT on the unique idempotency_key makes a repeat key a no-op.
      // No row returns on conflict => enqueued:false (the seam has no rowCount).
      const res = await db.query<{ id: string }>(
        `insert into queue_jobs (id, type, payload, idempotency_key, state)
           values ($1, $2, $3::jsonb, $4, 'ready')
         on conflict (idempotency_key) do nothing
         returning id`,
        [job.id, job.type, JSON.stringify(job.payload), job.idempotencyKey]
      );
      return { enqueued: res.rows.length > 0 };
    },

    async claim(opts: ClaimOptions): Promise<QueueJob[]> {
      // Guarded-UPDATE claim (PGlite-portable; no FOR UPDATE SKIP LOCKED).
      // The inner SELECT is the visibility gate: ready+visible rows whose
      // visibility has lapsed (covers both never-claimed and unacked-redelivery
      // because claim leaves state='inflight' but ack never ran — see below we
      // also reclaim lapsed in-flight rows). visible_at is pushed to
      // now + visibilityTimeoutMs so an unacked job reappears.
      return db.transaction(async (tx: Queryable) => {
        const res = await tx.query<QueueJobRow>(
          `update queue_jobs
              set state = 'inflight',
                  attempts = attempts + 1,
                  claimed_at = now(),
                  visible_at = now() + ($1::bigint * interval '1 millisecond')
            where id in (
              select id from queue_jobs
               where state in ('ready', 'inflight')
                 and visible_at <= now()
               order by visible_at asc
               limit $2
            )
          returning id, type, payload, idempotency_key, attempts`,
          [opts.visibilityTimeoutMs, opts.max]
        );
        return res.rows.map(toQueueJob);
      });
    },

    async ack(jobId: string): Promise<void> {
      await db.query(
        `update queue_jobs set state = 'done', claimed_at = null where id = $1`,
        [jobId]
      );
    },

    async retry(jobId: string, delayMs: number): Promise<void> {
      // attempts already bumped at claim time; re-arm with backoff.
      await db.query(
        `update queue_jobs
            set state = 'ready',
                claimed_at = null,
                visible_at = now() + ($2::bigint * interval '1 millisecond')
          where id = $1`,
        [jobId, delayMs]
      );
    },

    async deadLetter(jobId: string, reason: string): Promise<void> {
      await db.query(
        `update queue_jobs
            set state = 'dead_letter', claimed_at = null, dead_letter_reason = $2
          where id = $1`,
        [jobId, reason]
      );
    },

    async stats(): Promise<QueueStats> {
      // ready = ready+visible OR in-flight whose visibility lapsed (reclaimable);
      // inflight = in-flight still inside its window; deadLetter = parked.
      // Mirrors the in-memory adapter's stats exactly.
      const res = await db.query<{
        ready: number;
        inflight: number;
        dead_letter: number;
      }>(
        `select
           count(*) filter (
             where (state = 'ready' and visible_at <= now())
                or (state = 'inflight' and visible_at <= now())
           )::int as ready,
           count(*) filter (
             where state = 'inflight' and visible_at > now()
           )::int as inflight,
           count(*) filter (where state = 'dead_letter')::int as dead_letter
         from queue_jobs`
      );
      const row = res.rows[0];
      return {
        ready: row?.ready ?? 0,
        inflight: row?.inflight ?? 0,
        deadLetter: row?.dead_letter ?? 0,
      };
    },
  };
}
