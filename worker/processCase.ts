/**
 * The heart of the Stage 4 worker: durably process one label-verification case.
 *
 * `processCaseJob` replicates what `app/api/verify/route.ts` does in-request
 * (extract label → deterministic score → verdict) but does it durably: every
 * step is a guarded state transition with an append-only processing attempt and
 * audit trail, and every failure routes to an explicit, visible case state per
 * the plan's Case State Machine + Error Flow.
 *
 * Outcome routing (production-gap-closure "Temporal Decisions" / Error Flow):
 *   model ok:true                  -> persist label fields + verdict,
 *                                     case -> clean_match | has_mismatches | needs_review,
 *                                     attempt 'succeeded', ack
 *   model 'malformed'|'refusal'|'empty'
 *                                  -> NO verdict (no misleading score),
 *                                     attempt 'failed', case -> needs_review
 *                                     (or 'failed' when extraction is impossible),
 *                                     ack (poison content won't succeed on retry)
 *   model 'timeout' (retryable)    -> attempts remain: queue.retry(backoff),
 *                                     case -> retry_wait, attempt 'failed'
 *                                  -> attempts exhausted: queue.deadLetter,
 *                                     case -> dead_letter -> failed, attempt 'dead_letter'
 *
 * The case state machine (`assertCaseTransition`, enforced inside the repos /
 * finalizeAttempt) guards every move; an at-least-once duplicate delivery on an
 * already-advanced case throws an invalid-transition error that is caught and
 * surfaced as a {kind:'skipped'} outcome rather than a second result.
 *
 * Worker-safe: shared core + adapters only; no next/react.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { buildMatchReport } from "@/lib/engine/score";
import type { ColaApplication, ExtractedLabel, MatchReport } from "@/lib/contract";
import { canCaseTransition, type CaseState } from "@/lib/core/state/case";

import type { QueueJob } from "@/lib/adapters/queue/types";
import type { LabelExtractionInput } from "@/lib/adapters/model/types";

import { getCase, setCaseStatus } from "@/lib/db/repositories/cases";
import { getCaseFile, listCaseFiles } from "@/lib/db/repositories/caseFiles";
import { startAttempt } from "@/lib/db/repositories/processingAttempts";
import { insertExtractedFields } from "@/lib/db/repositories/extractedFields";
import { insertVerdict } from "@/lib/db/repositories/verdicts";
import { insertWarningEvidence } from "@/lib/db/repositories/warningEvidence";
import { appendAuditEvent } from "@/lib/db/repositories/auditEvents";
import { finalizeAttempt } from "@/lib/db/services/finalizeAttempt";

import type { WorkerDeps } from "./deps";
import { DEFAULT_MAX_ATTEMPTS } from "./deps";
import {
  loadApplication,
  applicationToFields,
  ApplicationUnavailableError,
  LABEL_FIELD_PREFIX,
} from "./application";

/** Ruleset version stamped on every verdict (compliance versioning, plan R6). */
export const WORKER_RULESET_VERSION = "engine-1";

/** The validated job payload: identifies the case to process. */
export const CaseJobPayload = z.object({
  caseId: z.string().min(1),
  /** Optional explicit label-file id; otherwise the case's label file is used. */
  labelFileId: z.string().min(1).optional(),
  /** Trace id propagated from intake through logs/attempts/audit. */
  traceId: z.string().min(1).optional(),
});
export type CaseJobPayload = z.infer<typeof CaseJobPayload>;

/**
 * Discriminated outcome of processing one job — what the loop / ops surface.
 * Every branch the worker can take is a named kind so callers (and tests) route
 * on it instead of inspecting DB state.
 */
export type CaseOutcome =
  | { kind: "scored"; caseId: string; overall: CaseState; matchPercentage: number }
  | { kind: "needs_review"; caseId: string; reason: string }
  | { kind: "failed"; caseId: string; reason: string }
  | { kind: "retried"; caseId: string; attempt: number; backoffMs: number }
  | { kind: "dead_letter"; caseId: string; reason: string }
  | { kind: "skipped"; caseId: string; reason: string }
  | { kind: "invalid"; reason: string };

/** Map the engine's overall verdict onto the terminal scored case state. */
function overallToCaseState(overall: MatchReport["overall"]): CaseState {
  switch (overall) {
    case "all_match":
      return "clean_match";
    case "has_mismatches":
      return "has_mismatches";
    case "needs_review":
      return "needs_review";
  }
}

/** Linear backoff: 1s, 2s, 3s … per attempt. Deterministic and bounded. */
function backoffMs(attempt: number): number {
  return attempt * 1000;
}

/**
 * Process a single case job end to end. Never throws on an expected failure
 * path — it finalizes the case to a visible state and returns a typed outcome.
 * Truly unexpected errors propagate so the loop can record them per-job.
 */
export async function processCaseJob(
  deps: WorkerDeps,
  job: QueueJob
): Promise<CaseOutcome> {
  const maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  // 1. Validate the job payload at the seam (never trust the queue's shape).
  const parsed = CaseJobPayload.safeParse(job.payload);
  if (!parsed.success) {
    // Malformed payload is poison: dead-letter so it cannot loop silently.
    await deps.queue.deadLetter(job.id, "invalid job payload");
    return { kind: "invalid", reason: "invalid job payload" };
  }
  const { caseId, labelFileId, traceId } = parsed.data;

  // 2. Load the case. A missing case is a non-retryable poison job.
  const caseRow = await getCase(deps.db, caseId);
  if (!caseRow) {
    await deps.queue.deadLetter(job.id, `case not found: ${caseId}`);
    return { kind: "invalid", reason: `case not found: ${caseId}` };
  }

  // 3. Guard the claim with the state machine. Only an unprocessed case
  //    (queued / retry_wait) may begin extraction. A duplicate delivery on an
  //    already-terminal case is harmless: skip without a second result.
  if (caseRow.status !== "queued" && caseRow.status !== "retry_wait") {
    await deps.queue.ack(job.id);
    return {
      kind: "skipped",
      caseId,
      reason: `case already in '${caseRow.status}', not re-processing`,
    };
  }

  // 4. Move into extracting and open an append-only attempt (guarded + audited).
  //    Pre-check the transition so a lost race / duplicate delivery is a clean
  //    skip rather than a thrown invalid-transition (the state machine still
  //    enforces it inside transitionCase as the authoritative guard).
  if (!canCaseTransition(caseRow.status, "extracting")) {
    await deps.queue.ack(job.id);
    return {
      kind: "skipped",
      caseId,
      reason: `cannot transition '${caseRow.status}' -> 'extracting'`,
    };
  }
  await transitionCase(deps, caseId, "extracting", traceId, "begin_extraction");
  const attemptId = randomUUID();
  await startAttempt(deps.db, {
    id: attemptId,
    caseId,
    stage: "extracting",
    traceId: traceId ?? null,
  });

  // 5. Run the model extraction on the label image.
  const result = await runExtraction(deps, caseId, labelFileId);

  // 5a. Failure routing.
  if (!result.ok) {
    return failExtraction(deps, job, caseId, attemptId, result, maxAttempts, traceId);
  }

  // 6. Success: load application, score, persist, finalize to a scored state.
  return scoreAndFinalize(
    deps,
    job,
    caseId,
    attemptId,
    result.data,
    labelFileId,
    maxAttempts,
    traceId
  );
}

// --- helpers ---------------------------------------------------------------

/** Resolve the case's label file and ask the model adapter to extract it. */
async function runExtraction(
  deps: WorkerDeps,
  caseId: string,
  labelFileId: string | undefined
): Promise<import("@/lib/adapters/model/types").ModelExtractionResult> {
  const input = await buildExtractionInput(deps, caseId, labelFileId);
  return deps.model.extractLabel(input);
}

/**
 * Load label bytes via storage and base64-encode them for the model adapter.
 * The stub model ignores its input, so a missing object yields an empty input
 * rather than failing the whole job in the offline harness; the real adapter
 * receives the actual bytes.
 */
async function buildExtractionInput(
  deps: WorkerDeps,
  caseId: string,
  labelFileId: string | undefined
): Promise<LabelExtractionInput> {
  const file = labelFileId
    ? await getCaseFile(deps.db, labelFileId)
    : (await listCaseFiles(deps.db, caseId)).find((f) => f.kind === "label") ?? null;

  if (!file?.object_key) {
    return { imageBase64: "", mimeType: "application/octet-stream" };
  }
  const obj = await deps.storage.get(file.object_key);
  if (!obj) {
    return { imageBase64: "", mimeType: file.content_type ?? "application/octet-stream" };
  }
  return {
    imageBase64: Buffer.from(obj.data).toString("base64"),
    mimeType: obj.contentType,
  };
}

/**
 * Route a failed extraction. Non-retryable content failures
 * (malformed/refusal/empty) finalize the case to a visible needs-review state
 * (or failed when the application is unavailable — handled in scoreAndFinalize,
 * not here) with NO verdict and ack the job. Retryable timeouts re-arm the job
 * with backoff until the bounded budget is spent, then dead-letter and finalize
 * the case to a visible failed state.
 */
async function failExtraction(
  deps: WorkerDeps,
  job: QueueJob,
  caseId: string,
  attemptId: string,
  result: Extract<
    import("@/lib/adapters/model/types").ModelExtractionResult,
    { ok: false }
  >,
  maxAttempts: number,
  traceId: string | undefined
): Promise<CaseOutcome> {
  const errorClass = result.error;
  const detail = result.raw ?? null;

  if (errorClass === "timeout") {
    // Retryable. `job.attempts` is the delivery count incremented at claim time,
    // so it already counts THIS delivery.
    if (job.attempts < maxAttempts) {
      const delay = backoffMs(job.attempts);
      // Attempt records the transient failure; case parks in retry_wait.
      await finalizeAttempt(deps.db, {
        attemptId,
        caseId,
        attemptState: "failed",
        errorClass,
        errorDetail: detail,
        nextAttemptAt: null,
        targetCaseState: "retry_wait",
        auditEventId: randomUUID(),
        traceId: traceId ?? null,
        reason: "transient extraction failure; scheduled retry",
      });
      await deps.queue.retry(job.id, delay);
      return { kind: "retried", caseId, attempt: job.attempts, backoffMs: delay };
    }

    // Budget exhausted -> poison. dead_letter the job, finalize case visibly.
    const reason = `extraction failed after ${job.attempts} attempts: ${errorClass}`;
    await transitionCase(deps, caseId, "dead_letter", traceId, "dead_letter");
    await finalizeAttempt(deps.db, {
      attemptId,
      caseId,
      attemptState: "dead_letter",
      errorClass,
      errorDetail: detail,
      targetCaseState: "failed",
      auditEventId: randomUUID(),
      traceId: traceId ?? null,
      reason,
    });
    await deps.queue.deadLetter(job.id, reason);
    return { kind: "dead_letter", caseId, reason };
  }

  // malformed / refusal / empty: bounded retries don't help (deterministic
  // poison content), so finalize to needs-review with no misleading score.
  // needs_review is only reachable from `scoring` in the case state machine, so
  // advance extracting -> scoring first (we entered scoring but produced no
  // verdict), then finalize scoring -> needs_review.
  const reason = `model extraction ${errorClass}; routed to human review`;
  await transitionCase(deps, caseId, "scoring", traceId, "enter_scoring");
  await finalizeAttempt(deps.db, {
    attemptId,
    caseId,
    attemptState: "failed",
    errorClass,
    errorDetail: detail,
    targetCaseState: "needs_review",
    auditEventId: randomUUID(),
    traceId: traceId ?? null,
    reason,
  });
  await deps.queue.ack(job.id);
  return { kind: "needs_review", caseId, reason };
}

/**
 * Score a successful extraction against the case's application and finalize.
 * Persists the extracted label fields and the verdict (and warning evidence
 * when the GOVERNMENT WARNING is uncertain), then transitions the case to the
 * scored terminal state and completes the attempt 'succeeded'.
 */
async function scoreAndFinalize(
  deps: WorkerDeps,
  job: QueueJob,
  caseId: string,
  attemptId: string,
  label: ExtractedLabel,
  labelFileId: string | undefined,
  maxAttempts: number,
  traceId: string | undefined
): Promise<CaseOutcome> {
  // Extraction succeeded: advance into the scoring stage (guarded + audited)
  // before any scored terminal state, per the case state machine.
  await transitionCase(deps, caseId, "scoring", traceId, "enter_scoring");

  let application: ColaApplication;
  try {
    application = await loadApplication(deps.db, caseId);
  } catch (err) {
    if (!(err instanceof ApplicationUnavailableError)) throw err;

    // No pre-persisted `application.*` fields (the real durable-batch path: a
    // batch started from real uploads never seeds them). Before failing, try to
    // extract the application from its uploaded file on demand.
    const resolved = await ensureApplication(deps, caseId);
    if (resolved.ok) {
      application = resolved.application;
    } else if (resolved.retryable && job.attempts < maxAttempts) {
      // Transient (timeout) extraction failure with budget remaining: re-arm the
      // job with backoff and park the case in retry_wait (mirrors failExtraction's
      // timeout branch, but from the scoring stage we already entered).
      const delay = backoffMs(job.attempts);
      await finalizeAttempt(deps.db, {
        attemptId,
        caseId,
        attemptState: "failed",
        errorClass: "timeout",
        errorDetail: resolved.reason,
        nextAttemptAt: null,
        targetCaseState: "retry_wait",
        auditEventId: randomUUID(),
        traceId: traceId ?? null,
        reason: "transient application extraction failure; scheduled retry",
      });
      await deps.queue.retry(job.id, delay);
      return { kind: "retried", caseId, attempt: job.attempts, backoffMs: delay };
    } else {
      // Non-retryable, or the retry budget is spent: extraction is impossible to
      // score, so finalize failed (not needs_review) with no misleading verdict.
      const reason = resolved.reason;
      await finalizeAttempt(deps.db, {
        attemptId,
        caseId,
        attemptState: "failed",
        errorClass: "application_unavailable",
        errorDetail: reason,
        targetCaseState: "failed",
        auditEventId: randomUUID(),
        traceId: traceId ?? null,
        reason,
      });
      await deps.queue.ack(job.id);
      return { kind: "failed", caseId, reason };
    }
  }

  // Mirror app/api/verify: pure deterministic scoring of the extracted label.
  const report = buildMatchReport(application, label);
  const targetState = overallToCaseState(report.overall);

  // Warning evidence crop: when the GOVERNMENT WARNING check is uncertain we
  // want a visual artifact the reviewer can open. Real region-based cropping is
  // a UI/image-pipeline concern not available in the worker/offline harness, so
  // we store the ORIGINAL label bytes under a stable evidence key and record the
  // normalized `region` in the verdict payload (engine already carries the
  // reason). The reviewer UI crops to `region` at display time. Done OUTSIDE the
  // DB transaction so a storage hiccup never rolls back the verdict.
  const warning = report.verdicts.find((v) => v.field === "governmentWarning");
  let cropObjectKey: string | null = null;
  if (warning && warning.status === "needs_review") {
    cropObjectKey = await storeWarningCrop(deps, caseId, labelFileId);
  }

  // Persist label fields + verdict (+ warning evidence) in one unit of work,
  // then finalize the attempt and transition the case in a second guarded unit.
  await deps.db.transaction(async (tx) => {
    await insertExtractedFields(tx, caseId, labelToFields(label));
    await insertVerdict(tx, {
      id: randomUUID(),
      caseId,
      overall: report.overall,
      matchPercent: report.matchPercentage,
      payload: report,
      rulesetVersion: WORKER_RULESET_VERSION,
    });

    // Warning evidence: when the GOVERNMENT WARNING check is itself uncertain
    // (engine emitted needs_review for it — e.g. unconfirmed lead-in boldness),
    // store an evidence row so the reviewer can inspect the typography
    // uncertainty. Prefer the model's own typography signals where supplied,
    // falling back to presence/verdict reason for legacy extractions.
    if (warning && warning.status === "needs_review") {
      const gw = label.governmentWarning;
      await insertWarningEvidence(tx, {
        id: randomUUID(),
        caseId,
        cropObjectKey,
        leadInDetected: gw.leadInDetected ?? gw.present,
        boldnessConfidence: gw.boldnessConfidence ?? null,
        uncertaintyReason: gw.boldnessUncertaintyReason ?? warning.reason,
        verdict: "needs_review",
      });
    }
  });

  await finalizeAttempt(deps.db, {
    attemptId,
    caseId,
    attemptState: "succeeded",
    targetCaseState: targetState,
    auditEventId: randomUUID(),
    traceId: traceId ?? null,
    reason: `scored ${report.overall} (${report.matchPercentage}%)`,
  });
  await deps.queue.ack(job.id);

  if (targetState === "needs_review") {
    return { kind: "needs_review", caseId, reason: report.summary };
  }
  return {
    kind: "scored",
    caseId,
    overall: targetState,
    matchPercentage: report.matchPercentage,
  };
}

/**
 * Outcome of resolving a case's application on demand: the parsed application,
 * or a typed failure carrying a human reason + whether it is retryable (a model
 * timeout). The caller routes retryable failures to bounded retry and everything
 * else (missing file/bytes, malformed/refusal/empty, contract-invalid) to a
 * terminal `failed`.
 */
type EnsureApplicationOutcome =
  | { ok: true; application: ColaApplication }
  | { ok: false; retryable: boolean; reason: string };

/**
 * On-demand application extraction for the durable-batch path. When a case has
 * NO pre-persisted `application.*` fields (a batch started from real uploads
 * only stores the application's bytes, not its extracted fields), find the
 * case's `application` case_file, load its bytes from storage, and ask the model
 * adapter to extract a ColaApplication.
 *
 * On success the extracted fields are persisted via {@link insertExtractedFields}
 * (namespaced `application.*`) so a later replay/duplicate delivery reloads them
 * cheaply through {@link loadApplication} instead of re-calling the model.
 *
 * Routing of the model's discriminated result is the caller's job; this helper
 * just maps every dead end to a typed outcome and never throws on an expected
 * failure (missing file, missing bytes, model failure).
 */
async function ensureApplication(
  deps: WorkerDeps,
  caseId: string
): Promise<EnsureApplicationOutcome> {
  const file = (await listCaseFiles(deps.db, caseId)).find(
    (f) => f.kind === "application"
  );
  if (!file?.object_key) {
    return {
      ok: false,
      retryable: false,
      reason: `case ${caseId} has no application file to extract`,
    };
  }

  const obj = await deps.storage.get(file.object_key);
  if (!obj) {
    return {
      ok: false,
      retryable: false,
      reason: `case ${caseId} application bytes are missing from storage (${file.object_key})`,
    };
  }

  const result = await deps.model.extractApplication({
    fileBase64: Buffer.from(obj.data).toString("base64"),
    mimeType: obj.contentType,
  });

  if (!result.ok) {
    return {
      ok: false,
      // Only a model 'timeout' is worth retrying; malformed/refusal/empty are
      // deterministic poison.
      retryable: result.error === "timeout",
      reason: `application extraction ${result.error}${result.raw ? `: ${result.raw}` : ""}`,
    };
  }

  // Persist the extracted application fields so replay/idempotency is cheap.
  await insertExtractedFields(
    deps.db,
    caseId,
    applicationToFields(result.data, () => randomUUID())
  );
  return { ok: true, application: result.data };
}

/**
 * Store a warning-evidence crop and return its object key, or null if no source
 * bytes are available. Offline / in the worker we cannot run a real image crop,
 * so we copy the original label bytes to a stable evidence key
 * (`evidence/{caseId}/warning-crop`); the normalized `region` recorded with the
 * verdict lets the reviewer UI crop at display time. Storage failures degrade to
 * null (the evidence row + reason still record the uncertainty) — never throw,
 * so an evidence hiccup can't fail an otherwise-scored case.
 */
async function storeWarningCrop(
  deps: WorkerDeps,
  caseId: string,
  labelFileId: string | undefined
): Promise<string | null> {
  try {
    const file = labelFileId
      ? await getCaseFile(deps.db, labelFileId)
      : (await listCaseFiles(deps.db, caseId)).find((f) => f.kind === "label") ??
        null;
    if (!file?.object_key) return null;
    const obj = await deps.storage.get(file.object_key);
    if (!obj) return null;

    const cropKey = `evidence/${caseId}/warning-crop`;
    await deps.storage.put(cropKey, obj.data, { contentType: obj.contentType });
    return cropKey;
  } catch {
    // Evidence is best-effort; the verdict + reason already capture the concern.
    return null;
  }
}

/** Flatten an extracted label into namespaced `extracted_fields` rows. */
function labelToFields(
  label: ExtractedLabel
): import("@/lib/db/repositories/extractedFields").ExtractedFieldValue[] {
  const out: import("@/lib/db/repositories/extractedFields").ExtractedFieldValue[] =
    [];
  for (const [key, value] of Object.entries(label)) {
    // governmentWarning is an object; store its presence + verbatim text.
    if (key === "governmentWarning") {
      const gw = value as ExtractedLabel["governmentWarning"];
      out.push({
        id: randomUUID(),
        fieldName: `${LABEL_FIELD_PREFIX}governmentWarning`,
        fieldValue: gw.present ? gw.text ?? "(present)" : null,
      });
      continue;
    }
    out.push({
      id: randomUUID(),
      fieldName: `${LABEL_FIELD_PREFIX}${key}`,
      fieldValue: value === null ? null : String(value),
    });
  }
  return out;
}

/**
 * Transition a case in its own guarded + audited unit of work. Used for the
 * in-flight moves (queued->extracting, ->dead_letter) that are not the terminal
 * finalize handled by `finalizeAttempt`.
 */
async function transitionCase(
  deps: WorkerDeps,
  caseId: string,
  next: CaseState,
  traceId: string | undefined,
  action: string
): Promise<void> {
  await deps.db.transaction(async (tx) => {
    const before = await getCase(tx, caseId);
    if (!before) throw new Error(`transitionCase: case not found: ${caseId}`);
    const updated = await setCaseStatus(tx, caseId, next);
    if (!updated) throw new Error(`transitionCase: case not found: ${caseId}`);
    await appendAuditEvent(tx, {
      id: randomUUID(),
      action,
      aggregateType: "case",
      aggregateId: caseId,
      beforeSummary: { status: before.status },
      afterSummary: { status: updated.status },
      traceId: traceId ?? null,
    });
  });
}
