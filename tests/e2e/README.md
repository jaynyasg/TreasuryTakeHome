# tests/e2e — deferred E2E smoke suite (stub)

This directory will hold the **Playwright** E2E smoke suite for the durable-batch
reviewer/admin workflows.

**It is intentionally NOT wired into `npm run verify` yet.** `npm run verify` must stay
deterministic and offline (it is the only quality gate — there is no CI). The repo
currently ships `puppeteer-core` + Vitest and **no Playwright**; adding the Playwright
dependency and live browser wiring is deferred to the observability/rollout stage
(Stage 9 / T10–T11), once the reviewer UI (T7) and admin ops console (T8) exist for the
flows to drive. At that point Playwright is added as a **separate script**, never folded
into the default `verify` gate.

## Required smoke scenarios (to implement in Stage 9)

1. Reviewer login → Work Queue.
2. Resumable intake (partial upload recovery / manifest pairing).
3. 300-case **stubbed** durable processing through to triage ordering.
4. Reviewer disposition + export download.
5. Admin dead-letter replay + operations health.

## Rationale

See `docs/designs/stage-1-preflight.md` §4 ("E2E Harness Decision (T0)") for the full
trade-off and why live wiring is deferred.
