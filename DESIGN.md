# DESIGN.md — Operational Design System (Reviewer / Admin)

Plan task **D5** (Design System). Resolves the design-debt TODO from
`docs/designs/production-gap-closure.md` ("create a short `DESIGN.md` before or during
implementation that codifies house-style usage for operational screens, including density,
table styling, status colors, focus states, and accessibility rules").

Scope: the **authenticated reviewer/admin workbench** (the durable-batch layer behind
`DURABLE_BATCH=1`) — the App Shell, Work Queue, Batch/Case Detail, Intake, Warning
Evidence, and the Operations Console. The always-on public core (`/`, Verify, Generate) is
its own simpler two-tab surface and is not re-specified here; both surfaces share the same
house-style tokens.

---

## 1. Foundation: house-style

The visual language is the house-style preset, copied into this repo and applied through
Tailwind:

- **Tokens / preset:** `styles/house-style/tailwind.preset.ts` + `tokens.json` (consumed
  by `tailwind.config.ts`). Base layer in `app/globals.css` (Inter Tight, tracking
  `-0.011em`, `ss01/cv11/cv02` font features, `prefers-reduced-motion` rules).
- **Primitives:** `components/house/*` — `Button`, `IconButton`, `Chip`, `Badge`, `Card`,
  `Modal`, `Stepper`, `icons`. **Reuse these; do not introduce parallel button/badge
  vocabularies.** New operational primitives compose them.

Aesthetic (from `PRD.md` frontend reference): calm, technical, light-mode editorial — a
**tool, not a consumer app**. Off-white canvas, warm-white opaque cards, near-black ink,
color reserved for meaning. The reviewer workbench is *denser and more operational* than
the public demo but uses the identical token set.

### Color tokens (semantic, not literal)

Code references token names, never raw hex, so a token change repaints everything:

| Token | Role |
|---|---|
| `canvas` / `surface` | App background / subtle inset background |
| `card` | Opaque content surface (rows, panels, modals) |
| `ink` / `ink-2` / `muted` / `muted-2` | Text from primary → de-emphasized |
| `line` | Hairline borders / dividers |
| `accent` | Brand accent (links, focus ring, eyebrow labels) |
| `accent-green` / `accent-amber` / `accent-red` | Severity: clean / needs-review / mismatch-or-fail |

---

## 2. Anti-generic UI constraints (the workbench rules)

From the locked plan's *Anti-Generic UI Constraints*. These are binding, not aspirational:

- **Workbench, not marketing page.** No centered hero copy, no decorative gradients, no
  colored-circle feature tiles, no repeated three-column feature grids, no ornamental icons.
- **Table/list-first.** Work Queue and Ops Console lead with the **rows that carry the
  work**. Priority counters and health tiles are compact summaries *above* the table, never
  the main surface.
- **Case Detail is comparison/evidence-first.** A decision header, field-comparison rows, a
  warning crop, and a timeline — **not** a stack of decorative summary cards.
- **Cards are bounded.** Allowed for repeated case rows, modals, evidence panels, and
  compact health summaries. **Not** for building page sections as nested/decorative card
  mosaics.
- **Utility copy only.** Status, evidence, risk, action, accountability. No aspirational
  product copy inside the reviewer/admin workflow.
- **Motion clarifies state, nothing else.** Progress, row updates, focus movement — yes.
  Decorative motion in review-critical screens — no. Honor `prefers-reduced-motion`
  (`globals.css` already disables decorative animations under it).

---

## 3. Component vocabulary (what is actually built)

| Group | Components | Role |
|---|---|---|
| `components/app-shell/` | `AppShell`, `RoleNav`, `PageHeader`, `PlaceholderScreen` | Persistent role-aware shell: header (mark, user+role, sign-out), left/top `<nav>`, `<main>` landmark, skip link |
| `components/intake/` | `IntakeWorkspace`, `ManifestTable`, `UploadDropzone`, `PreflightPanel`, `format` | Manifest-driven resumable intake + preflight summary (pairing, duplicates, unsupported files, cost/time) |
| `components/queue/` | `TriageTable`, `PriorityCounters`, `QueueFilters`, `QueueEmptyState`, `QueueTableSkeleton`, `format` | Triage-first Work Queue: priority counters above a dense, scannable case table |
| `components/case/` | `DecisionHeader`, `FieldComparisonTable`, `WarningEvidence`, `DispositionControls`, `EvidenceTimeline`, `dispositionRules` | Decision-first case file: verdict + required action → comparison → warning crop → timeline |
| `components/admin/` | `OpsTabs`, `OpsHealthStrip`, `DeadLetterTable`, `AssignmentsTable`, `ExportsTable`, `ReconciliationTable`, `RetentionPreviewTable`, `KillSwitchPanel`, `StatusPill`, `ReasonRequiredDialog`, `Forbidden403`, `format`, `killSwitches` | Operations Console: focused tabs (Health, Failed/Dead-letter, Assignments, Exports, Retention, Storage, Settings/Kill Switches) |
| `components/house/` | `Button`, `IconButton`, `Chip`, `Badge`, `Card`, `Modal`, `Stepper`, `icons` | Shared primitives every group above composes |

Naming is **domain-first** (batches, cases, warnings, dispositions in UI/domain code) over
**reusable primitives** (audit events, object manifests, job attempts, exports) underneath
(plan "Naming trajectory").

---

## 4. Density & layout

The workbench is intentionally denser than the public core:

- **Type scale:** body and table text run `12.5px`–`13px`; section eyebrows `10.5px`–`11px`
  uppercase with `0.08em` tracking; row metadata at `11px`–`11.5px`. Smaller than a
  consumer app, sized for scanning many rows.
- **Row rhythm:** stable row heights; long evidence summaries truncate to **two lines** with
  the full text available accessibly. Live updates never reshuffle the visible viewport —
  they mark changed rows and offer refresh.
- **Containers:** content within a `max-w-7xl` shell; `<main>` padded `px-4 py-5` (md:`px-6`).
  Persistent left nav at `md:w-56`, collapsing to a top bar on narrow viewports.
- **Surfaces:** opaque `card` rows on `canvas`; hairline `line` dividers; no drop-shadow
  stacks. Cards summarize; tables carry the work.

---

## 5. Tables & lists

The primary work surface. Rules:

- **Semantic structure.** Real table/list semantics with header cells; keyboard traversal
  and a visible focus state on interactive rows/controls.
- **Sortable/filterable controls** are labelled buttons/inputs (`QueueFilters`), not
  color-only affordances.
- **Work Queue row anatomy** (desktop, per plan): severity/status · case identity
  (batch, case id, brand, class/type, applicant) · issue summary (top mismatch/uncertainty
  in plain language) · evidence cue (warning/crop/confidence icon+label, failed-attempt
  count, or clean-match marker) · assignment (owner, claim/reassign, stale warning) ·
  updated time + ruleset version · one primary action. Mobile collapses to
  severity/status · identity · one issue summary · assignment · one action.
- **Stable sort:** severity bucket → status priority → updated time → case ID. Live updates
  show a refresh marker, never an automatic reshuffle.
- **Large queues** (up to 300 cases) use cursor pagination/virtualization with lightweight
  rows and lazy-loaded evidence timelines.
- **Ops tables** (`DeadLetterTable`, `ReconciliationTable`, `RetentionPreviewTable`, etc.)
  follow the same density/semantic rules; health tiles (`OpsHealthStrip`) are compact
  summaries above them.

---

## 6. Status colors — and the never-color-alone rule

Severity maps to three tokens: **green = clean/healthy**, **amber = needs-review/warning**,
**red = mismatch/alert/failed**, plus a **neutral** tone for informational states
(e.g. an export still generating).

**Binding rule (plan accessibility): severity is NEVER conveyed by color alone.** Every
status indicator pairs the color with a **text label and a shape glyph**, and exposes an
SR-only name. This is implemented and is the pattern to follow:

- `components/admin/StatusPill.tsx` — each tone carries `pill` (color classes), `glyph`
  (`✓` ok, `▲` warn, `!` alert, `•` neutral), and an `sr` screen-reader name
  (`"warning: …"`). The glyph is `aria-hidden`; the SR name is a `sr-only` prefix.
- The same discipline applies to `StatusBadge`, queue severity badges, and any new severity
  surface: **color + label + icon/shape**, always.

A reviewer with color-vision deficiency, or reading a grayscale print/export, must still be
able to tell green from amber from red.

---

## 7. Focus states & keyboard

- **Visible focus on everything interactive.** Use `focus-visible:ring-2
  focus-visible:ring-accent/40` (the AppShell/links pattern) — a 2px accent ring, never
  `outline:none` without a replacement.
- **Skip link:** the App Shell provides a `sr-only` → `focus:not-sr-only` "Skip to content"
  link to `#main` (`AppShell.tsx`).
- **Keyboard traversal** through tables, filters, and nav; sortable/filterable controls are
  reachable and operable by keyboard.
- **Focus trapping** in `Modal`, dialogs (`ReasonRequiredDialog`), and drawers: trap focus,
  Escape closes, focus returns to the trigger, and the dialog has an accessible name.

---

## 8. Accessibility rules (binding acceptance criteria)

From the plan's *Responsive And Accessibility Specs*. Each is a ship gate for operational
screens:

- **Labels.** Every input has a *visible* label; placeholders are never the only label.
- **Landmarks.** Semantic landmarks for shell, navigation (`<nav aria-label>`), main content
  (`<main id="main">`), and complementary evidence/timeline panels.
- **Keyboard traversal.** Tables/lists support keyboard traversal, sortable/filterable
  controls, and a visible focus state.
- **Focus management.** Tabs, modals, and drawers have focus trapping, Escape behavior,
  return focus, and screen-reader names.
- **Touch targets.** Primary controls are **≥44px** in mobile/tablet layouts (e.g. shell
  controls use `min-h-[36px]`+ padding on desktop and meet 44px on touch layouts).
- **Contrast.** Body and status text meet **≥4.5:1** against their surface (house-style
  ink/muted tokens are chosen to satisfy this on `card`/`canvas`).
- **Severity not color-only.** Pair red/amber/green with label + icon/text (§6).
- **Warning-crop alternatives.** Warning evidence includes text alternatives: extracted
  warning text, whether lead-in/body segmentation was detected, confidence, and the
  uncertainty reason (`components/case/WarningEvidence.tsx`).
- **Live-region etiquette.** Live updates use **polite** announcements for status changes;
  they do **not** steal focus or reorder the visible viewport without user action.
- **Reduced motion.** `prefers-reduced-motion` disables decorative motion and preserves
  progress/state meaning through text (wired in `globals.css`).

---

## 9. Responsive posture

| Surface | Desktop | Tablet | Mobile |
|---|---|---|---|
| App shell | Persistent role-aware side/top nav, workspace visible | Collapsible nav, visible current section + fast switcher | Compact nav; intake review + case detail supported; bulk admin prefers larger viewport |
| Intake | Two-column: file/manifest + preflight/action | Single column, sticky start/resume | Upload/resume/status only; "continue on desktop" when large manifest inspection would be unsafe |
| Work Queue | Dense table, sticky filters, stable rows | Priority list, fewer columns, expandable rows | Scan/open-first: severity, identity, status, assignment, one action |
| Case Detail | Decision header + evidence in one scroll path | Sticky decision header above stacked evidence | Decision + key reasons first; crop/comparison stack; disposition reachable with confirmation |
| Ops Console | Tabbed workspace with tables | Tabs → segmented control; tables → lists where needed | Health read-only + emergency kill-switch visibility; bulk replay/retention prefer larger viewport |

Full mobile parity for dense bulk admin actions (replay, retention, large-manifest
inspection) is intentionally **not** in scope; mobile guarantees scan/open/status/emergency
visibility.

---

## 10. Interaction state coverage

Every async operational screen defines and renders: **loading, empty, error (with trace
ID), success, partial, stale, permission-denied, and disabled-by-kill-switch** states (the
plan's Core UI State Table for Intake, Work Queue, Batch Detail, Case Detail, Ops Console,
Exports, Retention). Notably:

- **Trust framing throughout:** the machine verdict is labelled **advisory**; the human
  disposition is **authoritative** (the public core footer says the same).
- **Disposition rules** (`components/case/dispositionRules.ts`, unit-tested): Approve enabled
  only when evidence loaded + assignment current; Reject always requires a reason; Request-
  better-image requires a reason category + affected-file list; needs-review is a routing
  state, not a final human disposition; stale/already-dispositioned cases disable final
  actions until refresh.
- **Disabled-by-kill-switch** states explain what is paused and which jobs continue
  (`KillSwitchPanel`, `lib/flags.ts`).
