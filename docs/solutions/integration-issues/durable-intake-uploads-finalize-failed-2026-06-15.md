---
title: "Durable intake uploads finalized failed instead of scoring"
date: 2026-06-15
category: integration-issues
module: "durable worker / intake"
problem_type: integration_issue
component: background_job
symptoms:
  - "Every real uploaded case in the durable-batch path finalized in the failed state with no verdict"
  - "Worker storage.get(object_key) returned null for the label (key lookup miss)"
  - "Worker threw ApplicationUnavailableError because application.* fields were never populated"
  - "Bug invisible offline: the harness/smoke seeded application fields and stored the label at a matching key, bypassing both seams"
root_cause: missing_workflow_step
resolution_type: code_fix
severity: high
tags:
  - durable-batch
  - worker
  - intake
  - object-key
  - application-extraction
  - startbatch
---

# Durable intake uploads finalized failed instead of scoring

## Problem

Durable-batch uploads (behind the `DURABLE_BATCH` flag) silently finalized every case as
`failed` with no verdict, even for clean, matchable label/application pairs. A reviewer who
started a real batch from uploaded files saw cases dead-end at `failed` (error class
`application_unavailable`) instead of a scored match percentage — the durable path was
effectively non-functional in production while the entire offline test suite stayed green.

## Symptoms

- Real durable uploads finalized in state `failed` with error class/detail
  `application_unavailable`, never reaching a scored state (`clean_match` / `has_mismatches` /
  `needs_review`).
- No `verdicts` row was ever written for the case — scoring never ran.
- In the worker, `deps.storage.get(object_key)` for the label returned `null`, because
  `case_files.object_key` was recorded as the bare file name (e.g. `case001_label.png`) while
  the bytes lived at `intake/{sessionId}/case001_label.png`.
- The application PDF's `application.*` fields were absent, so `loadApplication` threw
  `ApplicationUnavailableError` and the worker finalized `failed`.
- Reproducible **only** through a real upload → `startBatch` → worker run; the offline
  unit/integration/smoke suite passed.

## What Didn't Work

The bug was completely masked by the tests. The offline worker harness
(`tests/worker/harness.ts`) seeded the case's `application.*` extracted fields directly via
`insertExtractedFields(... applicationToFields(application, ...))` **and** stored the label
under a key that already matched what the worker reconstructed. Both integration seams were
short-circuited:

1. The harness pre-persisted application fields, so `loadApplication` always succeeded and the
   missing extraction step was never exercised.
2. The harness stored bytes at a matching key, so the `object_key` mismatch never surfaced.

Result: unit and integration tests were green while the real `intake → startBatch → worker`
wiring was broken. The gap only appeared on a live deploy test driving an actual upload — the
classic "tests pass but the real path was never run."

## Solution

Fixed in commit `0a28533` — two seams.

**Fix 1 — object-key mismatch (`lib/db/services/startBatch.ts`).** The upload route
(`app/api/intake/[id]/files/route.ts`) writes bytes to `intake/{sessionId}/{fileName}`.
`insertCaseFileFromManifest` must record the same key; it previously recorded the bare file
name:

```ts
// BEFORE — case_files.object_key didn't match where bytes were written
objectKey: entry.fileName,

// AFTER — derived from the same convention the upload route uses
objectKey: `intake/${intakeSessionId}/${entry.fileName}`,
```

(The session id is now threaded into `insertCaseFileFromManifest` from both call sites.)

**Fix 2 — on-demand application extraction.** A discriminated-union `extractApplication` was
added to the model adapter seam so the worker can route its outcomes exactly like the label
path:

```ts
// lib/adapters/model/types.ts
export type ApplicationExtractionResult =
  | { ok: true; data: ColaApplication }
  | { ok: false; error: ModelExtractionError; raw?: string };

export interface ModelAdapter {
  extractLabel(input: LabelExtractionInput): Promise<ModelExtractionResult>;
  extractApplication(input: ApplicationExtractionInput): Promise<ApplicationExtractionResult>;
}
```

The OpenAI adapter (`lib/adapters/model/openai.ts`) wraps the existing
`lib/applicationExtract.ts`, classifies failures into `timeout` / `refusal` / `empty` /
`malformed`, and parses every success through the `ColaApplication` zod contract before
returning `ok: true`. The stub adapter gained `DEFAULT_STUB_APPLICATION`.

The worker (`worker/processCase.ts`) now catches `ApplicationUnavailableError` in
`scoreAndFinalize` and extracts on demand instead of failing immediately:

```ts
// worker/processCase.ts — scoreAndFinalize catch
if (!(err instanceof ApplicationUnavailableError)) throw err;

const resolved = await ensureApplication(deps, caseId);
if (resolved.ok) {
  application = resolved.application;               // continue to scoring
} else if (resolved.retryable && job.attempts < maxAttempts) {
  await deps.queue.retry(job.id, backoffMs(job.attempts));   // timeout -> retry_wait
  return { kind: "retried", caseId, attempt: job.attempts, backoffMs: delay };
} else {
  return { kind: "failed", caseId, reason: resolved.reason }; // terminal, no misleading verdict
}
```

`ensureApplication` finds the case's `application` case_file, loads its bytes from storage,
calls `deps.model.extractApplication`, and on success **persists** the fields via
`insertExtractedFields(... applicationToFields(result.data, ...))` so a replay reloads them
cheaply. Only `error === "timeout"` is retryable; `malformed` / `refusal` / `empty` are
terminal. Proven by `tests/smoke/durablePath.test.ts`, which now drives
`startBatch → worker → clean_match` with **no** preloaded data; 495 tests green.

## Why This Works

The root cause was two missing/incorrect integration steps in the durable path that the
synchronous `app/api/verify` path didn't have:

1. `case_files.object_key` is now derived from the same `intake/{sessionId}/{fileName}`
   convention the upload route writes to, so `storage.get` resolves the bytes.
2. The application-extraction workflow step — implicit in the manual flow — is now performed
   in the worker, the correct home for it because the project boundary keeps all LLM calls in
   API routes / the worker, never in the pure engine.

Because extraction failures reuse the same `timeout → retry`, `malformed/refusal/empty → fail`
routing as label extraction, the durable path inherits the existing reliability semantics.
Persisting the extracted `application.*` fields makes duplicate delivery and dead-letter
replay idempotent and cheap — a re-run reloads via `loadApplication` instead of re-calling the
model.

## Prevention

- **Exercise the real seam in at least one test.** `tests/smoke/durablePath.test.ts` now drives
  `startBatch → worker` with NO preloaded application fields and bytes stored under the upload
  route's actual key scheme (`buildRealIntakeWithPair`, calling `startBatch` with no
  `applications` arg and asserting `clean_match` + a 100% verdict). The harness's
  `withApplicationFields` / `withApplicationFile` options now make the state-seeding **opt-in**
  rather than the default.
- **Treat "all tests pass but the real wiring was never exercised" as a smell.** When a harness
  seeds the exact state a production seam is supposed to *produce*, it cannot catch a broken
  seam — at least one test must produce that state through the real code path.
- **Derive shared keys from one source.** The bug existed because the writer (upload route) and
  the reader's key record (`startBatch`) computed the storage key independently and drifted.
  Assert that object keys come from the same code path that stores the bytes; the invariant is
  now pinned in the comment on `insertCaseFileFromManifest`.
- **Add a deploy-time smoke for the durable path** (a live upload → scored case) so key /
  extraction drift surfaces at deploy time rather than in production.

## Related Issues

- [`docs/designs/observability-and-rollout.md`](../../designs/observability-and-rollout.md) —
  the ID-correlation table is the authority on the `objectKey` contract
  (`case_files.object_key` as object-manifest source of truth; storage keys derived from ids)
  that the object-key seam violated.
- [`docs/designs/production-gap-closure.md`](../../designs/production-gap-closure.md) — the
  originating plan; see its "post-deploy durable-path smoke" through
  intake → Blob → DB → queue → worker → model, the exact path this fix makes pass.
- [`ARCHITECTURE.md`](../../../ARCHITECTURE.md) — the durable batch flow
  (`startBatch → Postgres + queue → worker claims → extract+score → verdict`) and the two
  newly-wired seams called out in §4.
- [`README.md`](../../../README.md) §3 and §5 — already narrate that real uploads now score.
- No GitHub issue tracker entry; the fix commit's "R5" refers to a PRD requirement id
  (`PRD.md` — batch upload), not an issue number.
