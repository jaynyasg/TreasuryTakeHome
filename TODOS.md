# TODOS

## DONE — Public 300-file full-application runner (implemented 2026-06-15)
- **What:** The deployed core verifier now accepts up to 300 complete COLA application PDFs or
  image scans in the Full COLA Applications section. It keeps browser memory bounded by storing
  file handles in state and reading each file only when a four-wide client worker starts that
  case; canceling stops new dispatches while preserving completed results.
- **Source:** /design-review gap closure for the deployed take-home.

## DONE — Durable server-side batch (was P3, implemented 2026-06-13)
- **What:** The durable server-side batch path from the locked `docs/designs/production-gap-closure.md`
  plan is now implemented behind the `DURABLE_BATCH` feature flag: Postgres persistence
  (`lib/db/`), poll-mode worker (`worker/`), queue/storage/model adapters (`lib/adapters/`),
  durable intake concierge (`lib/intake/`), Auth.js reviewer/admin, and the ops console.
- **Remaining sub-feature:** live client-side progress *streaming* (SSE/websocket push of batch
  progress to the browser) is not built — the reviewer Work Queue + Operations console poll/refresh
  instead. Real-time push remains a future enhancement.
- **Source:** /goal staged execution 2026-06-13 (Stages 2–9). Superseded the original P3 TODO.

## DONE — Operational design system notes (was P3, implemented 2026-06-13)
- **What:** `DESIGN.md` now codifies house-style usage for the reviewer/admin operational screens —
  density, table/list styling, status colors (severity never color-only), focus states, and the
  accessibility rules. Resolves the design-debt note from `/plan-design-review`.
- **Source:** Stage 10 / design task D5.

## Future enhancements (not blocking)
- Live progress streaming (SSE) for durable batches (see above).
- Live Playwright browser E2E suite (a deterministic offline E2E smoke exists at
  `tests/smoke/durablePath.test.ts`; browser wiring is deferred per `docs/designs/stage-1-preflight.md` §4).
- Dedicated cropped-region endpoint for warning evidence (currently the label image is served as
  evidence context alongside the boldness/lead-in metadata).
- Worker heartbeat + measured model-spend readers wired into `getOpsHealth` (currently injectable
  defaults).
