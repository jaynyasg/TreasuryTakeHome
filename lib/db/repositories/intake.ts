import type { Queryable } from "@/lib/db/client";
import type { FileKind, ManifestEntryStatus } from "@/lib/intake/types";

/**
 * Repository for the intake aggregate: `intake_sessions` + `manifest_entries`
 * (migration 0004_intake; plan T4).
 *
 * Every function takes a `Queryable` first arg so it composes inside a
 * service-owned `transaction()` (plan "Transaction ownership"); these functions
 * never open transactions themselves. The interesting behaviour lives in two
 * places:
 *   - `createIntakeSession` is idempotent on `idempotency_key` (INSERT ON
 *     CONFLICT DO NOTHING, then SELECT) so refresh/retry/double-submit returns
 *     the SAME session (plan "Idempotent intake").
 *   - `setIntakeStatus` enforces the forward-only lifecycle
 *     draft → preflighting → ready → processing, throwing on any illegal move.
 */

/** Forward-only intake session lifecycle (mirrors the 0004 CHECK list). */
export type IntakeStatus = "draft" | "preflighting" | "ready" | "processing";

/** A row from `intake_sessions`. */
export interface IntakeSessionRow {
  id: string;
  batch_id: string | null;
  idempotency_key: string;
  manifest_hash: string | null;
  status: IntakeStatus;
  created_at: string;
  updated_at: string;
}

/** A row from `manifest_entries`. */
export interface ManifestEntryRow {
  id: string;
  intake_session_id: string;
  file_name: string;
  kind: FileKind;
  case_key: string;
  checksum: string | null;
  size_bytes: number | null;
  content_type: string | null;
  status: ManifestEntryStatus;
  object_key: string | null;
  created_at: string;
}

/** Fields accepted when creating an intake session. */
export interface CreateIntakeSessionInput {
  id: string;
  idempotencyKey: string;
  manifestHash?: string | null;
}

/** Allowed forward transitions for the intake session lifecycle. */
const INTAKE_FORWARD: Readonly<Record<IntakeStatus, readonly IntakeStatus[]>> = {
  draft: ["preflighting"],
  preflighting: ["ready"],
  ready: ["processing"],
  processing: [],
};

/** Thrown by {@link setIntakeStatus} on an illegal (non-forward) transition. */
export class IllegalIntakeTransitionError extends Error {
  readonly from: IntakeStatus;
  readonly to: IntakeStatus;

  constructor(from: IntakeStatus, to: IntakeStatus) {
    super(`Invalid intake transition: '${from}' -> '${to}'.`);
    this.name = "IllegalIntakeTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Idempotent create: insert the session, or — when `idempotency_key` already
 * exists — return the pre-existing row unchanged. A refresh/retry/double-submit
 * therefore never creates a second session (plan "Idempotent intake").
 */
export async function createIntakeSession(
  db: Queryable,
  input: CreateIntakeSessionInput
): Promise<IntakeSessionRow> {
  await db.query(
    `insert into intake_sessions (id, idempotency_key, manifest_hash, status)
     values ($1, $2, $3, 'draft')
     on conflict (idempotency_key) do nothing`,
    [input.id, input.idempotencyKey, input.manifestHash ?? null]
  );
  const existing = await getIntakeByIdempotencyKey(db, input.idempotencyKey);
  if (!existing) {
    // Should be unreachable: the row was either inserted or already present.
    throw new Error(
      `createIntakeSession: session for key '${input.idempotencyKey}' not found after upsert.`
    );
  }
  return existing;
}

export async function getIntakeSession(
  db: Queryable,
  id: string
): Promise<IntakeSessionRow | null> {
  const res = await db.query<IntakeSessionRow>(
    "select * from intake_sessions where id = $1",
    [id]
  );
  return res.rows[0] ?? null;
}

export async function getIntakeByIdempotencyKey(
  db: Queryable,
  idempotencyKey: string
): Promise<IntakeSessionRow | null> {
  const res = await db.query<IntakeSessionRow>(
    "select * from intake_sessions where idempotency_key = $1",
    [idempotencyKey]
  );
  return res.rows[0] ?? null;
}

/** Fields accepted when adding a manifest entry. */
export interface AddManifestEntryInput {
  id: string;
  intakeSessionId: string;
  fileName: string;
  kind: FileKind;
  caseKey: string;
  checksum?: string | null;
  sizeBytes?: number | null;
  contentType?: string | null;
  status: ManifestEntryStatus;
  objectKey?: string | null;
}

export async function addManifestEntry(
  db: Queryable,
  input: AddManifestEntryInput
): Promise<ManifestEntryRow> {
  const res = await db.query<ManifestEntryRow>(
    `insert into manifest_entries
       (id, intake_session_id, file_name, kind, case_key, checksum,
        size_bytes, content_type, status, object_key)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     returning *`,
    [
      input.id,
      input.intakeSessionId,
      input.fileName,
      input.kind,
      input.caseKey,
      input.checksum ?? null,
      input.sizeBytes ?? null,
      input.contentType ?? null,
      input.status,
      input.objectKey ?? null,
    ]
  );
  return res.rows[0];
}

/** List a session's manifest entries, oldest first (stable manifest order). */
export async function listManifestEntries(
  db: Queryable,
  intakeSessionId: string
): Promise<ManifestEntryRow[]> {
  const res = await db.query<ManifestEntryRow>(
    `select * from manifest_entries
      where intake_session_id = $1
      order by created_at asc`,
    [intakeSessionId]
  );
  return res.rows;
}

/** Update one manifest entry's status (e.g. exclude, mark duplicate/missing). */
export async function setManifestEntryStatus(
  db: Queryable,
  id: string,
  status: ManifestEntryStatus
): Promise<ManifestEntryRow | null> {
  const res = await db.query<ManifestEntryRow>(
    `update manifest_entries set status = $2 where id = $1 returning *`,
    [id, status]
  );
  return res.rows[0] ?? null;
}

/**
 * Move a session forward in its lifecycle, guarded by {@link INTAKE_FORWARD}.
 * Reads the current status, asserts `current -> next` is a forward transition
 * (throws {@link IllegalIntakeTransitionError} otherwise), then writes. Returns
 * the updated row, or null when no session with `id` exists.
 */
export async function setIntakeStatus(
  db: Queryable,
  id: string,
  next: IntakeStatus
): Promise<IntakeSessionRow | null> {
  const current = await getIntakeSession(db, id);
  if (!current) return null;

  if (!INTAKE_FORWARD[current.status].includes(next)) {
    throw new IllegalIntakeTransitionError(current.status, next);
  }

  const res = await db.query<IntakeSessionRow>(
    `update intake_sessions
        set status = $2, updated_at = now()
      where id = $1
      returning *`,
    [id, next]
  );
  return res.rows[0] ?? null;
}

/** Link a session to the batch it became (set inside startBatch's transaction). */
export async function setIntakeBatchId(
  db: Queryable,
  id: string,
  batchId: string
): Promise<void> {
  await db.query(
    `update intake_sessions set batch_id = $2, updated_at = now() where id = $1`,
    [id, batchId]
  );
}
