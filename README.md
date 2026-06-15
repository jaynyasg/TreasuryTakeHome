# TTB Label Verify — AI-Powered Alcohol Label Verification

Prototype for the TTB Compliance Division: checks what's printed on an alcohol beverage
label against its COLA application (TTB Form 5100.31) — every field, with a match
percentage and a written reason for every verdict — plus a mock application + label
generator for testing. Built per [PRD.md](PRD.md).

**Live demo:** https://treasury-takehome-tau.vercel.app
&nbsp;·&nbsp; **Architecture:** [`ARCHITECTURE.md`](ARCHITECTURE.md) (the as-built, two-tier system)

![Demo: verify a real COLA label (100% match), an honestly-flagged bad photo, and a mixed batch with real + generated labels](docs/demo.gif)

> The graded take-home is the **always-on core** (requirements R1–R11): no database, no
> login, one `OPENAI_API_KEY`. That is the default experience and the deployed URL. A
> separate **production durable-batch layer** (behind `DURABLE_BATCH=1`) implements the
> locked production plan — it is additive and never regresses the core. Skip to it only if
> you want the production depth.

---

## 1. What it is + quick start (the core)

Two flows, two tabs, one button each:

- **Verify a label** — enter/prefill the application fields and attach the matching label
  files, **or** upload up to 4 complete COLA application files in the full-form section
  (each file verified as its own case). Match report in ~5 seconds: overall %, per-field
  match / mismatch / missing / needs-review, and a plain-English reason for each. A
  "Try a bad photo" chip demos honest needs-review on a perspective-skewed scan.
- **Generate test cases** — seeded mock application+label pairs, clean or with injected
  defects (wrong ABV, missing warning, title-case "Government Warning:", swapped brand…),
  rendered to PDF and verified through the **same pipeline** as uploaded files. Batch at
  3–300 cases (300 confirm-gated with measured cost/wall-clock), optionally mixed with real
  COLA label sets and degraded photos, with progress, cancellation, per-case download, and
  an escaped CSV export carrying every verdict's reason.

```bash
npm install
echo OPENAI_API_KEY=sk-... > .env.local
npm run dev          # http://localhost:3000
```

Click **Load real example** on the Verify tab to prefill a real approved COLA
(OTIUM CELLARS, TTB ID 10200001000187) with its actual label scans, then **Verify label**.

**The core needs no database, no auth, and no other env var.** `OPENAI_API_KEY` is the only
requirement.

### The gate

```bash
npm run verify   # typecheck + lint + unit tests + offline eval (deterministic, fast, free)
```

| Check | Command | What it proves |
|---|---|---|
| Unit tests | `npm test` | Warning rules, normalizers, scoring, generator, batch isolation, retry seam, COLA parser, CSV escaping, state machines, adapter contracts, fixture sync |
| Offline eval | `npm run eval` | Golden cases (real COLAs + degraded photos + generated) replayed from recorded extractions — deterministic, free |
| Live eval | `npm run eval:live` | Re-extracts with GPT-4o and re-grades (costs credits); `-- --only <prefix>` scopes spend |
| Full gate | `npm run verify` | typecheck + lint + unit + offline eval |

There is no CI; `npm run verify` (plus a Stop hook) is the gate. Run `npm run eval:live`
once before submission so the degraded-image proof reflects current model behavior.

---

## 2. Requirements coverage (R1–R11)

| # | Requirement | Where it's satisfied |
|---|---|---|
| R1 | Match % + what doesn't match + why | `lib/engine/score.ts` per-field verdicts → match %; reasons on every field |
| R2 | Mock application + label generator | `lib/engine/generator.ts` — seeded, deterministic, defect-injecting, batch; `GeneratorView.tsx` |
| R3 | ~5s verification | ~4.5s measured end-to-end; single LLM call (`lib/extract.ts`) + pure scoring; ≤5s p50 target codified in `lib/config/limits.ts` |
| R4 | Simple, obvious UI | `app/page.tsx` — two tabs, one primary button each; calm house-style |
| R5 | Batch upload | `GeneratorView.tsx` client batch runner (concurrency 4); production server-side path in §3 |
| R6 | Fuzzy/judgment matching | `lib/engine/normalize.ts` — `STONE'S THROW` ≡ `Stone's Throw`, `750 MILLILITERS` ≡ `750 mL`, proof↔ABV, address boilerplate, with explanations |
| R7 | Word-for-word warning, all-caps bold | `lib/engine/warning.ts` — exact text; "GOVERNMENT WARNING:" must be all caps (title case rejected); uncertain boldness → needs-review |
| R8 | Standalone, no COLA integration | No COLA write-back; registry lookup falls back to a committed cached fixture |
| R9 | No sensitive storage | Core persists nothing server-side; entered/generated per session |
| R10 | Network-mindful | One outbound (OpenAI) behind a single adapter seam; COLA lookup degrades gracefully when blocked. See migration roadmap §4–5 for the no-outbound path |
| R11 | Imperfect images (stretch) | Proven by eval: degraded cases (blur/glare/rotation/perspective/shadow/phone-photo) must never be confidently wrong **and** still extract the core fields |

### How the core works

```
label files ──> GPT-4o vision (structured output) ──> zod contract gate ─┐
application ─────────────────────────────────────────────────────────────┴─> deterministic matching engine ──> report
```

- **`lib/contract.ts`** — one typed zod contract at every seam (LLM output, API routes,
  client). External payloads parse at the boundary; shape drift, refusals, and truncation
  become clean errors, never undefined behavior.
- **`lib/extract.ts`** — the only LLM call. GPT-4o reads the label verbatim (temperature 0,
  JSON-schema-constrained, placeholder scrubbing).
- **`lib/engine/`** — pure deterministic functions, fully unit-tested, no I/O:
  `warning.ts` (word-for-word warning, all-caps lead-in), `normalize.ts` (judgment-tier
  equivalences with explanations), `score.ts` (verdicts → %; unreadable regions →
  needs-review, not mismatch), `generator.ts` (seeded mock generator, ground truth by
  construction).

---

## 3. Production durable-batch layer (optional, `DURABLE_BATCH=1`)

The locked production plan (`docs/designs/production-gap-closure.md`) expands the core into
a durable, recoverable batch review system — **additive, behind a feature flag, never
regressing the core**. With the flag off (default), `/`, the verifier, and the generator
are the only active surface; the reviewer/admin area is gated and the durable tables sit
dormant.

### Architecture

```
Reviewer/Admin browser
   │
   ▼
Next.js on Vercel  ── UI/API front door: Auth.js, Intake, Work Queue, Case Detail, Ops Console
   ├──► Vercel Blob            (raw uploads · warning crops · export artifacts)
   ├──► Postgres  ◄────────────(batches/cases/files · assignments/dispositions ·
   │                            jobs/attempts · audit events · retention/exports — source of truth)
   └──► Queue ──► off-Vercel Worker  (extraction · scoring · evidence · retry/dead-letter · export/purge)
```

- **Vercel** owns intake, assignment, reviewer disposition, and admin actions.
- The **worker** (`worker/`, containerized, poll-mode, `GET /healthz`) owns processing
  attempts, extraction, verdicts, warning evidence, retry/dead-letter, retention cleanup,
  and exports. It reuses the **same `lib/engine` oracle** as `/api/verify` — scoring is
  never re-implemented.
- **Auth.js** (NextAuth v5) Credentials provider with scrypt hashes and Postgres-backed
  reviewer/admin roles; route gating in `middleware.ts` only when the flag is on.

### Run it locally

```bash
# in .env.local, in addition to OPENAI_API_KEY:
AUTH_SECRET=$(openssl rand -base64 32)
DATABASE_URL=postgres://...        # pooled endpoint for Vercel functions
DURABLE_BATCH=1

npm run seed        # apply migrations + seed reviewer@ttb.gov / admin@ttb.gov
npm run seed:demo   # (optional) seed a reviewer-visible demo batch of scored cases so you can
                    #   tour Work Queue → Case Detail → disposition → export WITHOUT the worker
                    #   or OpenAI. Run `npm run seed` first. Needs DATABASE_URL.
npm run worker      # poll-mode worker + /healthz (separate process)
npm run dev         # reviewers land on /reviewer/queue, admins on /admin
```

> **Demoing the durable layer live (cross-process) needs more than Vercel.** The worker is a
> long-lived poll process and **Vercel has no place to run it**. A live durable demo additionally
> requires **Vercel Blob** (`BLOB_READ_WRITE_TOKEN` + `STORAGE_PROVIDER=vercel-blob`) so the web
> process and the separate worker share uploaded bytes, plus a host running `npm run worker`.
> A Vercel-Cron "queue tick" route is the documented serverless option to run the worker on
> Vercel alone — but that route is **not built yet**. `npm run seed:demo` is the zero-infra way
> to tour the reviewer UI (it writes scored cases directly).

See [`.env.local.example`](.env.local.example) for every variable, kill switches, and seed
passwords. Provider preflight (Vercel Queues beta, Blob signed-access, Postgres pooling,
Auth.js) is documented in [`docs/designs/stage-1-preflight.md`](docs/designs/stage-1-preflight.md);
operations (trace IDs, metrics, alerts, rollout, rollback, secret rotation) in
[`docs/designs/observability-and-rollout.md`](docs/designs/observability-and-rollout.md);
operational design system in [`DESIGN.md`](DESIGN.md).

---

## 4. Approach, tools, and decisions

- **One typed contract at every seam.** `lib/contract.ts` (zod) gates LLM output, API
  payloads, and worker jobs — parse-or-fallback, never trust shape.
- **Deterministic engine, pure functions.** `lib/engine/` does all scoring/normalization/
  warning logic with no I/O and no LLM SDK, so a model swap cannot silently change verdicts
  and the whole engine is unit-testable and free to run.
- **Driver-agnostic DB seam.** `lib/db/client.ts` exposes one `Queryable`/`DbClient`
  interface; the same repository code runs against **PGlite** (in-process, offline tests)
  and **`pg` Pool** (production) unchanged — repositories take a `Queryable`, service-command
  modules own transactions so a state change + its audit event commit in one unit of work.
- **Adapter seams for every provider.** Storage / queue / model
  (`lib/adapters/*`) keep Vercel Blob / Vercel Queues / OpenAI SDK calls at the edge behind
  shared contract tests, so each is a one-file swap for a government posture (see roadmap).
- **Shared state machines.** Batch/case lifecycles are first-class typed state machines
  (`lib/core/state/*`) enforced at API/worker mutation boundaries, with invalid-transition
  tests; the SQL `CHECK` constraints mirror them exactly.
- **Deterministic offline eval + on-demand live eval.** `npm run eval` replays recorded
  extractions (free, in the gate); `npm run eval:live` re-extracts with GPT-4o for a reality
  check (costs credits, on demand).
- **scrypt/credentials auth, not an IdP.** R10: the TTB network blocks outbound traffic, so
  a self-contained Credentials provider has zero outbound IdP dependency and is honest about
  being a prototype; an SSO adapter seam is left for the government posture.

**Stack:** Next.js 15 (App Router, TypeScript) on Vercel · Tailwind v3 + house-style preset ·
OpenAI GPT-4o · Postgres (`pg`) / PGlite for tests · Vercel Blob · Auth.js (NextAuth v5) ·
Vitest.

---

## 5. Assumptions, trade-offs, and limitations

Per the brief's guidance to *document trade-offs or limitations*:

- **Form editions.** The provided COLA examples use the 2009-edition Form 5100.31 (states
  alcohol content + net contents); the current 04/2023 revision dropped those boxes and
  added grape varietal(s). The app supports **both** — value-match when ABV/net are filled
  (2009-style), or verify label *presence* per 27 CFR when blank (how TTB checks today).
  Wine applications can declare varietals matched against label class/type.
- **Demo-scale.** The core batch runner fans out **client-side** (concurrency 4, tested at
  6–12); a tab close abandons the queue (a guard warns first). The durable layer is the
  production answer to 200–300-at-once.
- **Durable layer is wired end-to-end; a live cross-process demo needs Blob + a worker host.**
  The intake→worker handoff is now **wired**: `startBatch` records each `case_files.object_key`
  as `intake/{sessionId}/{fileName}` (byte-identical to the upload route), and the worker
  extracts the application PDF **on demand** (`extractApplication`) when application fields are
  absent — so real uploads now **score** (they previously finalized `failed`). The **offline
  durable-path smoke** (`tests/smoke/durablePath.test.ts`: PGlite + memory queue + fake storage
  + stub model) drives `startBatch → worker → clean_match → disposition → export` deterministically
  in the gate. The remaining requirement for a **live** cross-process demo is shared **Vercel
  Blob** (the web and worker must read the same uploaded bytes) + a **worker host** running
  `npm run worker`; Vercel cannot run the poll worker, and the Vercel-Cron "queue tick" route is
  the serverless option but is **not yet built**. Real Postgres was validated against Neon
  (17 tables, migrations 0001–0004, seeded users).
- **E2E browser harness deferred.** The repo has Vitest + `puppeteer-core`, not Playwright;
  the live browser E2E suite (reviewer login, resumable intake, 300-case stubbed processing,
  disposition+export, admin replay) is specified but deferred to the rollout stage so it
  never enters the deterministic `verify` gate (`docs/designs/stage-1-preflight.md` §4). An
  offline E2E-equivalent smoke is present.
- **No real COLA integration** (R8) and **bold detection** is judged by the vision model
  (`headingStyle`), not pixel-level font forensics.
- **Class/type synonyms** ("Table Red Wine" vs "Dry Red Wine") are deliberately flagged for
  review, not auto-equated — false approvals cost more than reviews.
- **Prototype, not government-compliant.** This is a standalone proof-of-concept; it makes
  **no claim** of current FedRAMP/government-production compliance. Every step to that
  posture (identity, storage, in-boundary model, no-outbound network, SIEM, formal
  retention) is a bounded swap at a named seam with a defined validation gate — see
  [`docs/designs/government-migration-roadmap.md`](docs/designs/government-migration-roadmap.md).

---

## Deployment

Production: https://treasury-takehome-tau.vercel.app (Vercel). Deploys via the **Vercel GitHub
integration — pushing to `main` on the GitHub remote auto-redeploys**; `vercel --prod` is an
alternative manual trigger. The **only required production env for the graded core is
`OPENAI_API_KEY`** (no DB/worker/Blob). The graded posture is **`DURABLE_BATCH` unset/off**, so
the reviewer/admin routes are hidden (`/login` 200, `/` 200, `/api/verify` 405 for GET,
`/reviewer/queue` 404). Standing up the durable layer additionally needs `DATABASE_URL`,
`AUTH_SECRET`, Vercel Blob (`BLOB_READ_WRITE_TOKEN` + `STORAGE_PROVIDER=vercel-blob`), and an
off-Vercel worker host — see [`ARCHITECTURE.md`](ARCHITECTURE.md) §7.

## Repo map

```
app/                Next.js App Router — public core (page.tsx) + /api + (reviewer) area
components/         UI; components/house = house-style primitives; queue/case/intake/admin/app-shell = workbench
lib/contract.ts     zod boundary contract — the spine
lib/engine/         pure matching engine (unit-tested)
lib/extract.ts      GPT-4o vision seam (core)
lib/core/           worker-safe core: contract + engine + state machines
lib/db/             driver-agnostic client, migrations, repositories, service-commands, seed
lib/adapters/       storage / queue / model provider seams (+ shared contract tests)
lib/{auth,flags,observability,config}/  auth/authz · feature flags+kill switches · trace/log · limits
worker/             off-Vercel poll-mode worker (Dockerfile, health, loop, processCase, application)
eval/               golden cases, label images, recorded extraction snapshots
scripts/            eval.ts, seed.ts, seed-demo.ts, prove.ts, smoke-api.ts, demo-gif.mjs, make_gif.py, make_degraded.py
tests/              vitest unit + offline integration/smoke suites (incl. tests/smoke/durablePath.test.ts)
ARCHITECTURE.md     the as-built, two-tier architecture (core + durable layer)
DESIGN.md           operational design system (reviewer/admin)
docs/designs/       locked production plan + preflight + observability + migration roadmap
PRD.md              full take-home brief + derived requirements R1–R11
```
