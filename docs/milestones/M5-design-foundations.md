# M5 — Design foundations

**Goal:** replace the unstyled native-HTML UI with a small, documented design
system — global Tailwind design tokens, a color palette with usage guidelines,
styled reusable primitives and composites — then re-skin every existing surface
using only those pieces. **Purely presentational:** no behavior, contract,
domain, or event changes; every prior e2e script must pass unchanged.

Placement (decided by Mitchell 2026-07-11, mid-M4): after M4 so it doesn't
disrupt in-flight work, before further UI breadth (Atomic changes UI, Solo
delight) so new surfaces are built *on* the system instead of re-skinned later,
and well before Collaboration (M8) so its hard UX problems are designed against
a polished single-player baseline.

Design record, ADR (if any irreversible choice emerges, e.g. component-library
adoption), and task plan are due at M5 kickoff per the standard process — this
file defines scope and gate only.

## Kickoff record (2026-07-11)

- Exit gate below **confirmed unchanged by Mitchell**.
- Component-library decision: **shadcn/ui adopted** (Mitchell, overriding the
  hand-rolled presumptive default) — ADR-010, including the per-component
  native-semantics rule (no Radix Select; no react-hook-form).
- Aesthetic direction: **Field Kit** (paper/ink/teal, mono-for-data signature).
- Design record: `docs/specs/2026-07-11-M5-design-foundations-design.md` ·
  System reference: `docs/guidelines/design-system.md` ·
  Task plan: `docs/plans/2026-07-11-M5-design-foundations.md`.

## Wave 2 — Layout & surfaces (scope expansion, 2026-07-12)

Wave 1 (PR #11) re-skinned every surface presentationally. Mitchell's 15 Vercel
comments surfaced four missing patterns. Wave 2 **reverses the "responsive out
of scope" exclusion inside M5** (Mitchell's call) and adds: responsive
container/breakpoint tokens, Sheet + Popover primitives, a client-state context
spine (ADR-012), URL-backed view routing, and a scope→surface editing paradigm
(ADR-011). It is desktop-first with mobile-capable tokens; no phone pass.
Spec: `docs/specs/2026-07-12-M5-layout-and-surfaces-design.md` ·
Plan: `docs/plans/2026-07-12-M5-layout-and-surfaces.md`.

Wave 1's "e2e changes are selector-only" rule does **not** apply to Wave 2:
Enter-to-search, editor-as-sheet, budget-in-settings, and the merged Schedule
lens are intentional behavior/structure changes, each justified in its commit.

### Wave 2 exit gate — all must be true

- [x] Every one of the 15 PR #11 comments is resolved (map in the spec) and
      demoed on the deployed Vercel URL at ≥1024px.
- [x] **ADR-011 validated:** a new global setting lands in Settings and a new
      activity field in the editor with no per-feature surface decision (R1);
      the editor is raised with prefill from ≥2 triggers (R2).
- [x] **ADR-012 validated:** grep shows no direct trip-context writes;
      `LensRouter` holds no `useState` mirror; a test proves `fireEvent.click`
      opens every overlay.
- [x] `docs/guidelines/design-system.md` amended: breakpoints/containers,
      overflow policy, surface vocabulary, field-with-context, date format, and
      the new inventory entries.
- [x] Enforcement green (color/element/style walls); `pnpm check` passes.
- [x] All M0–M4 e2e green; Wave-2 behavioral test changes each justified.
- [x] Still no `docs/contracts/CHANGELOG.md` entry (any contract change means
      scope crept).
- [x] Wave-2 retro note appended.

## Scope

- **Global Tailwind design tokens.** Introduce Tailwind CSS (new dev
  dependency — the app currently has no styling framework). The Tailwind config
  is the single source of truth for spacing scale, type scale, radii, shadows,
  and breakpoints. App code consumes tokens; no ad-hoc magic values.
- **Documented color palette + usage guidelines.** Brand colors, neutrals, and
  semantic colors (error / warning / success / info), plus gradient usage
  rules — with written *when-to-use-what* guidance (e.g. semantic error red is
  never decorative; brand accents never carry error meaning; how and when
  gradient steps of a hue are used). Documented text/background combinations
  meet WCAG AA contrast. Lives in `docs/guidelines/design-system.md`.
- **Styled reusable primitive elements.** Shared, styled components for the
  base vocabulary — headings (h1…), body text/span, labels, inputs, buttons,
  badges. These become the only way UI code renders these elements.
- **Styled reusable composite elements.** Forms, tables, and modals/dialogs
  composed from the primitives — including restyling existing chrome (conflict
  banner, history panel, undo/redo controls, lens switcher).
- **Re-skin the app.** Every existing Phase-1 surface — trip list, day-column
  board, backlog, history/time-travel UI, map/timeline/calendar views, the
  three M4 lenses, auth chrome — rebuilt on the primitives, composites, and
  palette guidelines. No functional changes ride along.
- **Skill-assisted execution.** The pass leverages the installed
  `frontend-design` skill (aesthetic direction, avoiding templated defaults)
  for the system design, and `web-design-guidelines` (Web Interface Guidelines
  compliance review) as the review gate on the re-skinned surfaces.

## Exit gate — all must be true (drafted 2026-07-11; confirmed by Mitchell at kickoff 2026-07-11)

- [x] **Demo on the deployed Vercel URL:** walk every Phase-1 surface (board,
      backlog, history, map/timeline/calendar, all three lenses) — consistent
      type scale, spacing, and palette throughout; no unstyled native controls
      anywhere.
- [x] `docs/guidelines/design-system.md` committed: tokens, the palette with
      when-to-use guidance (semantic vs brand vs gradients), and a component
      inventory (primitives + composites).
- [x] **Enforcement green:** no raw color literals (hex/rgb/hsl) in app code
      outside the token definitions (lint/grep wall, same spirit as the purity
      wall); text, inputs, and buttons render through the shared primitives.
- [x] Documented text/background combos pass WCAG AA contrast; a
      `web-design-guidelines` review of the re-skinned surfaces has no
      unaddressed findings.
- [x] **All M0–M4 e2e scripts green *unchanged*** — the milestone is purely
      presentational; selector-only test updates are acceptable, behavioral
      updates are a red flag.
- [x] No `docs/contracts/CHANGELOG.md` entry needed — and that stays true (any
      contract change means scope crept).
- [x] Retro note appended to this file.

## Explicitly out of scope

New features or behavior changes of any kind; dark mode; motion/animation
design beyond default transitions; a dedicated responsive/mobile redesign
(current breakpoint behavior just needs to not regress); print/export CSS
(deferred with the M4 lens export scope); extraction of the component set into
a published package; collaboration UX design (that's M8 planning); marketing or
landing pages. Adopting a component library (shadcn/radix) vs hand-rolled
primitives on Tailwind is a kickoff decision for Mitchell — hand-rolled is the
presumptive default; if a library is adopted, record it as an ADR.

## Wave 3 — Group-4 refinements (2026-07-13)

A second batch of Vercel comments on the Wave-2 deploy (16 new). The
unambiguous ones shipped as a fix pass; the design-ambiguous cluster (Group 4)
was brainstormed and built: board wrapped-grid + capped width (retires
horizontal scroll), whole-card drop targets, Map re-render fix
(`EditorHost` callback stabilization) + pin-list removal + fill height,
Schedule toggle restyle, header `BudgetMeter`, Timeline hour axis, `MoneyInput`
grouped-display inputs, and silent no-op commands. UI-layer only.
Spec: `docs/specs/2026-07-13-M5-wave3-refinements-design.md` ·
Plan: `docs/plans/2026-07-13-M5-wave3-refinements.md` ·
Feedback capture: `docs/design-feedback/2026-07-13-pr11-wave2-vercel-comments.md`.
Minor cosmetic/dead-code findings recorded as KI-4 in `docs/known-issues.md`.

## Retro — M5 closed (2026-07-19)

M5 shipped in **three waves**, all merged to `main` via the squash-merge of
PR #11 (`df3a37f`; the merge-commit title reads "Wave 1 + Wave 2" but the
squash contains all three waves). Mitchell demoed the deployed preview
(covering the Wave-3 surfaces) and confirmed it good; prod migration was run
(Wave 3 added no migrations — the M0–M4 schema is unchanged).

- **What went well:** the "read the feedback as a set, fix the underlying
  pattern" approach (Mitchell's) held across all three waves — Wave 2 turned 15
  comments into 4 patterns + 2 ADRs; Wave 3 turned the Group-4 cluster into six
  focused areas. The UI-only wall (zero diff to `packages/`, server, api,
  contracts) held for the entire milestone. Subagent-driven execution with
  per-task + final reviews kept quality high.
- **Honest scope note:** this milestone was drafted as "purely presentational,
  e2e unchanged." Wave 2 **intentionally reversed** that (recorded above and in
  the Wave-2 section): behavioral e2e changes were expected and each justified
  per commit. So the exit-gate line "All M0–M4 e2e green *unchanged*" is ticked
  in the **amended** sense — e2e is green, with behavioral changes justified —
  not the literal original wording. The scope expansion was Mitchell's explicit
  call, not drift.
- **Carried forward (not blockers):** KI-1 (pre-existing `packages/domain`
  property-test flake), KI-2 (over-budget conflict-banner amount stays
  ungrouped — domain-generated), KI-3/KI-4 (minor cosmetics) — all in
  `docs/known-issues.md`.
- **Ops follow-up (Mitchell):** the `migrate-production` CI job needs the
  `PRODUCTION_DATABASE_URL` GitHub Actions secret set so future migrations are
  automatic (this migration was run manually).
