# TreasuryTakeHome — AI-Powered Alcohol Label Verification

TTB COLA take-home: verify alcohol label images against their applications (match %, per-field
verdicts with reasons) + generate mock application/label pairs. Full brief: `PRD.md`.

## Stack & hosting
- Next.js 15 (App Router, TypeScript) at repo root, deployed on **Vercel**.
- Tailwind CSS **v3** with the house-style preset (`styles/house-style/`) — copied from
  `C:\Users\jaynyasg\OneDrive\Documents\GitLab\house-style`, may diverge; that repo stays canonical.
- **OpenAI GPT-4o** for label-image extraction and judgment-tier match explanations
  (`OPENAI_API_KEY` in `.env.local` / Vercel env).
- Vitest for unit tests; no CI — local `verify` + Stop hook is the gate.

## Boundaries
- `lib/contract.ts` is the single typed contract (zod) at every seam: LLM output, API routes,
  client. Validate external/LLM payloads at the seam — parse-or-fallback, never trust shape.
- Matching engine (`lib/engine/`) is pure functions, fully unit-tested, no I/O.
- LLM calls live only in API routes (`app/api/*`); the engine never imports the OpenAI SDK.
- Two tiers. The always-on CORE persists nothing server-side and batches client-side (no DB,
  no auth, needs only `OPENAI_API_KEY`); it is the graded default. The additive durable layer
  (behind `DURABLE_BATCH`) DOES persist to Postgres/Blob and processes batches via the
  off-Vercel worker — production-shaped, flag-gated, off in the graded deploy.
- No COLA integration. The core stores nothing; the durable layer (flag-on only) persists
  domain aggregates + audit events to Postgres and uploaded bytes to Blob.

## Workflow
- All work on `main`. Remotes: `origin` (GitLab labs) and `github`.
- `npm run verify` = typecheck + lint + unit + offline eval smoke (deterministic, fast).
  Live-LLM eval (`npm run eval:live`) is on-demand only.
- Hard requirements to honor (from PRD interviews): ≤5s verification, exact word-for-word
  GOVERNMENT WARNING check (all-caps lead-in), fuzzy brand matching with explanations,
  UI simple enough for non-technical users.

## Skill routing

When the user's request matches an available skill, invoke it via the Skill tool. When in doubt, invoke the skill.

Key routing rules:
- Product ideas/brainstorming -> invoke /office-hours
- Strategy/scope -> invoke /plan-ceo-review
- Architecture -> invoke /plan-eng-review
- Full review pipeline -> invoke /autoplan
- Bugs/errors -> invoke /investigate
- QA/testing site behavior -> invoke /qa or /qa-only
- Code review/diff check -> invoke /review
- Visual polish -> invoke /design-review
- Ship/deploy/PR -> invoke /ship or /land-and-deploy
- Save progress -> invoke /context-save
- Resume context -> invoke /context-restore
