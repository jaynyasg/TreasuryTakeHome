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
- Demo-scale batch (~10–30 at once); 300-at-once is a documented scale-path, not built.
- No COLA integration, no PII storage, nothing persisted server-side.

## Workflow
- All work on `main`. Remotes: `origin` (GitLab labs) and `github`.
- `npm run verify` = typecheck + lint + unit + offline eval smoke (deterministic, fast).
  Live-LLM eval (`npm run eval:live`) is on-demand only.
- Hard requirements to honor (from PRD interviews): ≤5s verification, exact word-for-word
  GOVERNMENT WARNING check (all-caps lead-in), fuzzy brand matching with explanations,
  UI simple enough for non-technical users.
