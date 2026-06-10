# TODOS

## P3 — Server-side batch queue with progress streaming and persistence
- **What:** Move the 50/300-case batch fan-out from client-side `runBatch` to a durable
  server-side queue with progress streaming, persisted results, and job recovery.
- **Why:** The production shape of the "morning queue" story — survives tab close,
  durable audit trail, recoverable jobs. Explicitly deferred from the 2026-06-10
  cathedral plan as infra-grade work.
- **Pros:** Completes the agent-queue vision honestly; removes the beforeunload guard
  and in-flight-billing caveats.
- **Cons:** Real infrastructure (queue + storage) — beyond prototype scope; new ops surface.
- **Context:** Client fan-out at concurrency 6 with bounded retry ships in the cathedral
  plan (AC-3). This TODO is its successor. Cancel semantics, retry classification, and
  the CSV schema from AC-3/AC-5 carry over unchanged.
- **Effort:** L (human ~1 week / CC ~M)
- **Depends on:** cathedral plan AC-3 landing.
- **Source:** /plan-ceo-review 2026-06-10 (deferred by design; see
  ~/.gstack/projects/jaygodfrey-treasurytakehome/ceo-plans/2026-06-10-cathedral-push.md)
