/**
 * Offline worker test harness: PGlite + fake storage + memory queue + stub
 * model. Fully deterministic — injected clock, no network, no real providers.
 *
 * Seeds the minimum durable state the worker reads for a case: a user, a batch,
 * a `queued` case, a label `case_file` (with a stored object), and the case's
 * application fields (the rows intake would write, namespaced `application.*`).
 */
import type { DbClient } from "@/lib/db/client";
import type { QueueAdapter } from "@/lib/adapters/queue/types";
import type { StorageAdapter } from "@/lib/adapters/storage/types";
import type { ModelAdapter } from "@/lib/adapters/model/types";
import type { ColaApplication } from "@/lib/contract";

import { createMemoryQueue } from "@/lib/adapters/queue/memory";
import { createFakeStorage } from "@/lib/adapters/storage/fake";
import { createStubModel } from "@/lib/adapters/model/stub";

import { insertBatch } from "@/lib/db/repositories/batches";
import { insertCase } from "@/lib/db/repositories/cases";
import { insertCaseFile } from "@/lib/db/repositories/caseFiles";
import { insertExtractedFields } from "@/lib/db/repositories/extractedFields";

import { migratedClient, seedUser } from "../db/helpers";
import { applicationToFields } from "@/worker/application";
import type { WorkerDeps } from "@/worker/deps";

/** A controllable clock the memory queue and worker share. */
export interface TestClock {
  now(): number;
  advance(ms: number): void;
}

export function createTestClock(start = 1_000_000): TestClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

/** A clean-match bourbon application (matches DEFAULT_STUB_LABEL). */
export const CLEAN_MATCH_APPLICATION: ColaApplication = {
  serialNumber: "12345001000123",
  beverageType: "distilled_spirits",
  sourceOfProduct: "domestic",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholContent: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  applicantNameAddress: "Old Tom Distillery, Louisville, KY",
};

export interface SeedCaseOptions {
  caseId?: string;
  batchId?: string;
  application?: ColaApplication;
  /** Store a label object + manifest row (default true). */
  withLabelFile?: boolean;
  /**
   * Persist the case's `application.*` extracted_fields (default true). Set
   * false to model the REAL durable-batch path, where startBatch stores the
   * application's bytes but not its extracted fields — the worker must extract
   * on demand. Pair with `withApplicationFile` so the worker has bytes to read.
   */
  withApplicationFields?: boolean;
  /**
   * Store an application object + case_file manifest row (default false). The
   * stored bytes let the worker's on-demand `ensureApplication` path run.
   */
  withApplicationFile?: boolean;
}

export interface SeededCase {
  caseId: string;
  batchId: string;
  ownerId: string;
  labelFileId: string | null;
  labelObjectKey: string | null;
  applicationFileId: string | null;
  applicationObjectKey: string | null;
}

/**
 * Seed one `queued` case with its label file + application fields. Returns ids
 * the test can assert against.
 */
export async function seedCase(
  db: DbClient,
  storage: StorageAdapter,
  opts: SeedCaseOptions = {}
): Promise<SeededCase> {
  const caseId = opts.caseId ?? `case-${Math.random().toString(36).slice(2, 10)}`;
  const batchId = opts.batchId ?? `batch-${caseId}`;
  const application = opts.application ?? CLEAN_MATCH_APPLICATION;
  const withLabelFile = opts.withLabelFile ?? true;
  const withApplicationFields = opts.withApplicationFields ?? true;
  const withApplicationFile = opts.withApplicationFile ?? false;

  const ownerId = await seedUser(db, "reviewer");
  await insertBatch(db, { id: batchId, ownerUserId: ownerId, status: "processing" });
  await insertCase(db, {
    id: caseId,
    batchId,
    status: "queued",
    brand: application.brandName,
    classType: application.classType,
    applicant: application.applicantNameAddress,
  });

  // Application fields (what intake persists; the worker reads these to score).
  // Skipped to model the real durable-batch path, where only the application's
  // bytes are stored and the worker must extract the fields on demand.
  if (withApplicationFields) {
    await insertExtractedFields(
      db,
      caseId,
      applicationToFields(application, (key) => `appfield-${caseId}-${key}`)
    );
  }

  let applicationFileId: string | null = null;
  let applicationObjectKey: string | null = null;
  if (withApplicationFile) {
    applicationObjectKey = `intake/${batchId}/application.pdf`;
    const stored = await storage.put(
      applicationObjectKey,
      new Uint8Array([0x25, 0x50, 0x44, 0x46]), // tiny %PDF-ish bytes
      { contentType: "application/pdf" }
    );
    applicationFileId = `file-${caseId}-application`;
    await insertCaseFile(db, {
      id: applicationFileId,
      caseId,
      kind: "application",
      objectProvider: "fake",
      objectKey: stored.key,
      checksum: stored.checksum,
      sizeBytes: stored.size,
      contentType: stored.contentType,
    });
  }

  let labelFileId: string | null = null;
  let labelObjectKey: string | null = null;
  if (withLabelFile) {
    labelObjectKey = `labels/${caseId}/front.png`;
    const stored = await storage.put(
      labelObjectKey,
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]), // tiny PNG-ish bytes
      { contentType: "image/png" }
    );
    labelFileId = `file-${caseId}-label`;
    await insertCaseFile(db, {
      id: labelFileId,
      caseId,
      kind: "label",
      objectProvider: "fake",
      objectKey: stored.key,
      checksum: stored.checksum,
      sizeBytes: stored.size,
      contentType: stored.contentType,
    });
  }

  return {
    caseId,
    batchId,
    ownerId,
    labelFileId,
    labelObjectKey,
    applicationFileId,
    applicationObjectKey,
  };
}

/** Enqueue a process-case job for `caseId`. */
export async function enqueueCaseJob(
  queue: QueueAdapter,
  caseId: string,
  jobId = `job-${caseId}`
): Promise<void> {
  await queue.enqueue({
    id: jobId,
    type: "process_case",
    payload: { caseId },
    idempotencyKey: `case:${caseId}:attempt`,
  });
}

export interface Harness {
  db: DbClient;
  queue: QueueAdapter;
  storage: StorageAdapter;
  clock: TestClock;
  deps: WorkerDeps;
}

/**
 * Build a full offline harness. `model` defaults to a clean-match stub; pass a
 * configured stub (e.g. a failure result) to exercise failure routing.
 */
export async function buildHarness(opts: {
  model?: ModelAdapter;
  maxAttempts?: number;
} = {}): Promise<Harness> {
  const db = await migratedClient();
  const clock = createTestClock();
  const queue = createMemoryQueue(clock.now);
  const storage = createFakeStorage();
  const model = opts.model ?? createStubModel();

  const deps: WorkerDeps = {
    db,
    queue,
    storage,
    model,
    now: clock.now,
    maxAttempts: opts.maxAttempts,
  };

  return { db, queue, storage, clock, deps };
}
