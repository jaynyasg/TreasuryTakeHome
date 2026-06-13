# Government Migration & Provider-Swap Roadmap

Plan task **T12** (Long-Term Trajectory). Satisfies the locked plan's
"Government migration roadmap" requirement (`docs/designs/production-gap-closure.md`):
documentation must *explicitly distinguish current prototype posture from target
government posture*, covering identity, storage, AI/provider swaps, network controls,
audit/logging, retention/legal policy, data migration, and validation gates.

> **This prototype does not claim current government-production compliance.** Per the
> Marcus Williams interview (`PRD.md`): the TTB runs on Azure, FedRAMP authorization took
> "18 months just for the paperwork," the network "blocks outbound traffic to a lot of
> domains," and this exercise is an explicitly *standalone proof-of-concept* with "nothing
> sensitive stored." Everything below labelled **Target** is a forward path, not an
> implemented state. The **Current** column is what ships today.

---

## 1. Posture at a glance

| Dimension | Current (prototype) | Target (government posture) | Swap surface |
|---|---|---|---|
| Identity | Auth.js (NextAuth v5) Credentials provider, scrypt password hashes, Postgres-backed `users` (reviewer/admin), seeded demo users | Enterprise / government SSO (PIV/CAC, SAML/OIDC IdP, e.g. Login.gov / Entra ID / Okta) with the same reviewer/admin role model | NextAuth `providers[]` + the role/authorization seam in `lib/auth/authorize.ts` |
| Storage | Vercel Blob for raw uploads, warning crops, exports; Postgres object-manifest as source of truth | FedRAMP-authorized object store (Azure Blob in a Gov region, or S3 in GovCloud) | `StorageAdapter` (`lib/adapters/storage/types.ts`) — swap `vercelBlob.ts` for a gov adapter |
| AI / model | OpenAI GPT-4o over the public API (extraction + judgment-tier explanations) | In-boundary / approved model: Azure OpenAI in an authorized tenant, or on-prem / in-VPC inference reachable without outbound internet | `ModelAdapter` (`lib/adapters/model/types.ts`) — swap `openai.ts` for an in-boundary client |
| Network | Public Vercel deployment, outbound to api.openai.com | Government network with no general outbound; all dependencies in-boundary or via an approved egress proxy | Adapter endpoints + deployment topology; no app-logic change |
| Audit / logging | Append-only `audit_events` rows + structured logs carrying trace/correlation IDs | SIEM integration (Splunk / Sentinel / CloudWatch) with retained, tamper-evident audit feed | `lib/observability/{trace,log}.ts` + `auditEvents` repo — add a SIEM sink |
| Retention / legal | 90-day archive + two-phase purge (preview → delete) + tombstones | Formal NARA-aligned records schedule, legal-hold, system-of-record retention | `retentionPurge` service + `retention_state` schema — policy + hold flags |
| Queue / worker | Vercel Queues (beta, poll mode) behind a `QueueAdapter`, off-Vercel worker; Postgres-outbox fallback | Managed broker inside the authorization boundary (Azure Service Bus / SQS in GovCloud) or the outbox path | `QueueAdapter` (`lib/adapters/queue/types.ts`) |
| Data | Add-only / expand-contract migrations (`0001`→`0004`), app-minted text IDs | Same migration discipline against the authorized Postgres; no destructive down-migrations | `lib/db/migrate.ts` + `migrations/*.sql` |

The architectural bet that makes all of this a *swap, not a rewrite*: provider-specific
SDK calls live only at adapter edges (`lib/adapters/{storage,queue,model}/*`), the
deterministic engine and contracts are framework-free worker-safe core (`lib/core/`),
and every correlation ID is **app-minted** so it survives crossing any system boundary
(`0001_init.sql` deliberately avoids `gen_random_uuid()` for this reason).

---

## 2. Identity — credentials → government SSO

**Current.** `auth.ts` wires a NextAuth Credentials provider whose `authorize()` reads a
user from Postgres and verifies a scrypt hash (`lib/auth/password.ts`). Sessions are JWT
(no DB session table). Roles (`reviewer`, `admin`) live in the `users` table and drive
central authorization (`lib/auth/authorize.ts`); reviewers are scoped to assigned
batches, admins are broader but still audited. Demo/staging users are seeded by
`npm run seed`.

**Why credentials, not an IdP, today.** R10: the TTB network blocks outbound traffic, and
the prototype must run on public Vercel with no privileged IdP. A self-contained
credentials provider has zero outbound IdP dependency and is honest about being a
prototype. This is a deliberate trade-off, not an oversight.

**Target.** Replace the Credentials provider with a government SSO provider in
NextAuth `providers[]` — SAML/OIDC against Login.gov, Entra ID (Gov), or Okta, or
PIV/CAC smartcard auth. The role model, JWT/session shape, and `authorize.ts` aggregate
checks are unchanged; only the provider and the user-provisioning path (JIT from IdP
claims vs. seeded rows) change. The adapter seam for this is called out in
`stage-1-preflight.md` §2 (Auth): "leave an explicit provider/adapter seam so enterprise /
government SSO can be added later without reworking the role and authorization model."

**Validation gates before this step:**

1. IdP integration test: role claim → app role mapping for reviewer and admin, plus a
   no-role / unauthorized claim → forbidden.
2. Forbidden-ID test still green (reviewer cannot reach an unassigned batch/case/file).
3. Session-revocation behavior verified (JWT expiry/rotation; `AUTH_SECRET` rotation
   invalidates sessions — see observability runbook §8).
4. Disposition identity capture: actor, role, timestamp, reason still land in
   `audit_events` for every disposition.

---

## 3. Storage — Vercel Blob → FedRAMP-authorized object store

**Current.** All bytes (raw uploads, warning-evidence crops, export artifacts) move through
the `StorageAdapter` interface (`lib/adapters/storage/types.ts`); `vercelBlob.ts` is the
live implementation, `fake.ts` the test double. The Postgres **object manifest** —
not the blob store — is the source of truth for object existence
(`checksum`, `size`, `contentType`, `objectKey`, retention state); reconciliation detects
drift. File access is via short-lived scoped signed URLs issued *only after* app-level
authorization, with an app-mediated proxy fallback when the provider cannot mint a
properly scoped URL (`getSignedUrl` returns `null` → proxy path).

**Target.** Swap `vercelBlob.ts` for a FedRAMP-authorized store: Azure Blob Storage in an
authorized Gov region (aligns with the TTB's existing Azure tenant) or S3 in AWS GovCloud.
Because the manifest, checksums, and retention metadata are provider-agnostic and already
persisted, the migration is: stand up the new adapter, satisfy the shared adapter contract
tests (`contractTest.ts`), backfill/copy existing objects keyed by manifest, flip
`STORAGE_PROVIDER`. No call-site changes.

**Validation gates before this step:**

1. New adapter passes the shared `StorageAdapter` contract suite (put/get/list/delete,
   missing-object, signed-access-or-null, checksum stability) identically to the Vercel one.
2. Signed-URL **or** proxy path satisfies authorization scoping + access audit logging in
   the new environment (preflight §2 Storage fallback rule).
3. Storage reconciliation run shows 0 missing / 0 orphaned after object backfill
   (observability runbook §3.7).
4. Retention metadata round-trips on the new provider (two-phase purge still works).

---

## 4. AI / provider swap — public GPT-4o → in-boundary model

**Current.** The only model boundary is the `ModelAdapter` (`lib/adapters/model/types.ts`):
one operation, `extractLabel`, returning a discriminated union
(`ok` | `malformed` | `refusal` | `empty` | `timeout`) so the worker routes outcomes
without catching thrown errors. `openai.ts` calls GPT-4o with temperature 0 and a
JSON-schema-constrained contract; every success is re-parsed through the zod contract
(`ExtractedLabel`) before it can flow inward. `stub.ts` is the deterministic offline
double. Deterministic scoring lives entirely outside the model in `lib/engine/`.

**Why this matters for R10.** The TTB firewall blocks outbound traffic to most domains,
including (per the failed scanning-vendor pilot) third-party ML endpoints. A public
OpenAI call cannot run inside that boundary. The prototype is deployed publicly per the
brief, but the swap path is a single adapter.

**Target.** Replace `openai.ts` with an in-boundary client:

- **Azure OpenAI** in the TTB's authorized Azure tenant/region — same GPT-4o-class model,
  same structured-output contract, reachable without general internet egress. Lowest-delta
  swap (the request shape is near-identical).
- **On-prem / in-VPC inference** — a self-hosted vision-capable model behind a private
  endpoint, for the strictest no-outbound posture. Higher integration cost; the adapter
  contract (and the zod parse-or-fail gate) is identical, so the engine and the rest of the
  pipeline do not change.

Because scoring is deterministic and model-independent, a model swap cannot silently change
verdicts — only extraction quality. That is exactly what the eval gate measures.

**Validation gates before this step:**

1. New adapter passes the shared `ModelAdapter` contract suite (success → contract-valid;
   malformed/refusal/empty/timeout routing).
2. `eval:live` against the new model meets the release thresholds: schema-valid output,
   no prompt-injection compliance bypass, exact word-for-word GOVERNMENT WARNING /
   all-caps behavior, and uncertain boldness routed to needs-review.
3. Degraded-image suite still satisfies "never confidently wrong" + extracts the core
   fields (R11 proof).
4. Single-case latency still meets the ≤5s p50 target (R3) on the in-boundary endpoint.

---

## 5. Network controls — public → no-outbound government network

**Current.** Public Vercel deployment; the app makes one class of outbound call
(OpenAI) plus provider calls to Vercel Blob/Queues/Postgres. The COLA registry lookup
already degrades to a committed cached fixture when `ttbonline.gov` is slow or blocking —
the prototype assumes a hostile network for that path.

**Target.** Deploy entirely inside the government authorization boundary with no general
outbound. Every dependency the app reaches — model, storage, queue, database — is an
in-boundary endpoint or routed through an approved egress proxy. Because all four are
adapter-mediated, *no application logic changes*; only endpoints and deployment topology
do. The worker is already containerized and portable (`worker/Dockerfile`, node-slim,
`CMD node dist/index.js`) for relocation off Vercel into the boundary.

**Validation gates before this step:**

1. Egress audit: enumerate every outbound host; confirm each is in-boundary or
   proxy-approved; zero calls to public internet from app or worker.
2. Connection-exhaustion check passes against the in-boundary Postgres (preflight §2/§3),
   since serverless/function clients must use the pooled endpoint.
3. Staging parity smoke green with all real in-boundary integrations at low limits.

---

## 6. Audit / logging — append-only events → SIEM

**Current.** Sensitive actions write **append-only** `audit_events` rows (actor, action,
aggregate type/id, before/after summary where safe, reason note, timestamp, trace ID,
source IP/user-agent when available). Correlation IDs (`traceId`, `batchId`, `caseId`,
`jobId`, `attemptId`, `exportId`, `intakeSessionId`) propagate across web → queue → worker
→ db → storage → model → export (`lib/observability/trace.ts`), and structured logs carry
them as fields so a search on any one ID returns the full timeline. Replay is append-only
(never overwrites prior evidence).

**Target.** Add a SIEM sink (Splunk / Microsoft Sentinel / CloudWatch Logs) so the
append-only audit feed and structured logs are shipped to the agency's monitoring estate
with tamper-evident retention and alerting. The vocabulary already exists; this is an
*additive* sink at `lib/observability/log.ts` plus an export of `audit_events`. The alert
thresholds and runbooks in `observability-and-rollout.md` §3 map directly to SIEM detection
rules (stuck jobs, dead-letter spikes, heartbeat loss, model/rate-limit spikes, retention
overdue, storage drift).

**Validation gates before this step:**

1. Every sensitive action under test emits an audit event with the required fields.
2. Trace IDs appear end-to-end in the SIEM for one sampled case (web → worker → export).
3. Audit immutability verified (append-only; no in-place update path).

---

## 7. Retention / legal policy — 90-day archive → formal records schedule

**Current.** A 90-day audit archive with automatic purge unless protected by admin policy.
Purge is **two-phase** (`retentionPurge` service): phase one marks records purge-eligible
and shows preview counts; phase two deletes/redacts retrievable archive data while writing
minimal **tombstones** for the deletion audit. A `PURGE_KILL_SWITCH` brake makes an
approved purge delete nothing. Retention state lives in `retention_state` with indexed
purge-eligibility queries.

**Target.** Replace the prototype 90-day window with a formal federal records schedule:
NARA-aligned retention periods, legal-hold flags that suspend purge for cases under
litigation/investigation, and (if policy requires) system-of-record permanent retention
beyond the archive. The two-phase preview→delete→tombstone mechanism, the kill switch, and
the audit trail are the right primitives; the policy layer (schedule, holds, exceptions)
sits on top of them. Permanent legal system-of-record retention beyond 90 days is explicitly
**Deferred To Later** in the locked plan.

**Validation gates before this step:**

1. Legal-hold flag suppresses purge for held aggregates (test: held case survives purge).
2. Purge preview counts match actual deletions; tombstones written for every deletion.
3. Records-schedule periods are configurable and audited; no silent destruction.

---

## 8. Data migration — add-only posture

**Current.** Migrations `0001_init` → `0004_intake` are **add-only / expand-contract**
(`tests/db/migrationRollback.test.ts` proves an old binary runs against the new schema).
There is **no destructive down-migration**: flag-off (`DURABLE_BATCH`) is the rollback, and
the additive schema sits dormant until the flag turns on the code that uses it. IDs are
app-minted `text` (not `gen_random_uuid()`) so they propagate through non-database systems.

**Target.** Carry the same add-only discipline into the authorized environment. Migrating
*to* government infrastructure is: provision the authorized Postgres, run the same
forward-only migrations, point the pooled endpoint at it, and (if data is carried over)
copy rows + re-key objects by manifest. No down-migrations are introduced; reversibility
stays at flag-off + kill switches (plan reversibility score 4/5).

**Validation gates before this step:**

1. Add-only migration compatibility test green on the target Postgres.
2. Flag-off behavior verified (durable tables exist, empty, unused; single-case core
   path unaffected).
3. Connection-exhaustion check passes at 300-case fan-out on the target instance.

---

## 9. Sequenced migration path

Each step is independently shippable and gated; the order minimizes boundary risk.

| Step | Move | Depends on | Gate (must pass before proceeding) |
|---|---|---|---|
| 0 | Confirm authorization boundary, FedRAMP/ATO scope, records schedule with agency | — | Written authority to operate plan; deferred-scope items (SSO, COLA write-back) confirmed |
| 1 | Stand up authorized Postgres; run add-only migrations | Step 0 | §8 gates (add-only compat, flag-off, connection budget) |
| 2 | Swap storage to FedRAMP object store | Step 1 | §3 gates (adapter contract, signed/proxy auth, reconciliation, retention round-trip) |
| 3 | Swap model to in-boundary (Azure OpenAI / on-prem) | Step 1 | §4 gates (adapter contract, `eval:live` thresholds, degraded-image, latency) |
| 4 | Relocate worker + queue into boundary; eliminate outbound | Steps 1–3 | §5 gates (egress audit zero public calls, parity smoke) |
| 5 | Swap identity to government SSO | Step 1 | §2 gates (claim→role mapping, forbidden-ID, disposition identity) |
| 6 | Wire SIEM audit/log sink | Steps 1–5 | §6 gates (audit fields, end-to-end trace in SIEM, immutability) |
| 7 | Apply formal records schedule + legal hold | Step 1, Step 6 | §7 gates (hold suppresses purge, tombstones, configurable schedule) |

Throughout, the locked plan's rollout discipline holds: ship behind `DURABLE_BATCH`,
keep the always-on single-case core available, use kill switches as brakes, and roll back
via flag-off + drain rather than destructive change (`observability-and-rollout.md` §§5–6).

---

## 10. Explicitly out of scope / deferred (no compliance claim)

Per the locked plan's *Deferred To Later* and the Marcus interview, the prototype makes
**no claim** of current government-production compliance. The following are forward work,
not implemented:

- Enterprise / government SSO and IdP integration (the adapter seam exists; the integration
  does not).
- Direct COLA system integration or write-back.
- Permanent legal system-of-record retention beyond the 90-day archive.
- Fully offline / government-network-only deployment (the no-outbound topology is a path,
  not a current deployment).
- FedRAMP / ATO authorization itself — a multi-month agency process, not a code change.

The value delivered today is that every one of these is a *bounded swap at a named seam*
with a *defined validation gate*, not a rewrite.
