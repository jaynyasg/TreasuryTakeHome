/**
 * Runs the shared queue contract against BOTH adapter implementations, proving
 * the in-memory fake and the Postgres outbox fallback satisfy identical
 * semantics. Both run fully offline: memory needs no I/O; the outbox runs on
 * PGlite via the migration helper.
 */
import { afterEach } from "vitest";
import type { DbClient } from "@/lib/db/client";
import { migratedClient } from "@/tests/db/helpers";
import { createMemoryQueue } from "@/lib/adapters/queue/memory";
import { createPostgresOutboxQueue } from "@/lib/adapters/queue/postgresOutbox";
import {
  runQueueContract,
  type QueueContractHarness,
} from "@/lib/adapters/queue/contractTest";

// Track PGlite clients so each is closed after its test (isolated per harness).
const openClients: DbClient[] = [];

afterEach(async () => {
  while (openClients.length > 0) {
    const db = openClients.pop();
    if (db) await db.close();
  }
});

// --- Memory adapter: drive a mutable injected clock. ---
runQueueContract("memory", async (): Promise<QueueContractHarness> => {
  // Start well above 0 so visibility math never goes negative.
  let clock = 1_000_000;
  const adapter = createMemoryQueue(() => clock);
  return {
    adapter,
    async advanceTime(ms: number) {
      clock += ms;
    },
  };
});

// --- Outbox adapter: drive time by rewinding stored timestamps. ---
// The table uses the DB clock (now()); advancing "time" forward is equivalent
// to moving every stored visible_at/claimed_at backward by the same amount, so
// the now()-relative comparisons cross their thresholds deterministically
// without sleeping.
runQueueContract("outbox", async (): Promise<QueueContractHarness> => {
  const db = await migratedClient();
  openClients.push(db);
  const adapter = createPostgresOutboxQueue(db);
  return {
    adapter,
    async advanceTime(ms: number) {
      await db.query(
        `update queue_jobs
            set visible_at = visible_at - ($1::bigint * interval '1 millisecond'),
                claimed_at = case
                  when claimed_at is null then null
                  else claimed_at - ($1::bigint * interval '1 millisecond')
                end`,
        [ms]
      );
    },
  };
});
