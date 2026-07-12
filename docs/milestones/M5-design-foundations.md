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

- [ ] Every one of the 15 PR #11 comments is resolved (map in the spec) and
      demoed on the deployed Vercel URL at ≥1024px.
- [ ] **ADR-011 validated:** a new global setting lands in Settings and a new
      activity field in the editor with no per-feature surface decision (R1);
      the editor is raised with prefill from ≥2 triggers (R2).
- [ ] **ADR-012 validated:** grep shows no direct trip-context writes;
      `LensRouter` holds no `useState` mirror; a test proves `fireEvent.click`
      opens every overlay.
- [ ] `docs/guidelines/design-system.md` amended: breakpoints/containers,
      overflow policy, surface vocabulary, field-with-context, date format, and
      the new inventory entries.
- [ ] Enforcement green (color/element/style walls); `pnpm check` passes.
- [ ] All M0–M4 e2e green; Wave-2 behavioral test changes each justified.
- [ ] Still no `docs/contracts/CHANGELOG.md` entry (any contract change means
      scope crept).
- [ ] Wave-2 retro note appended.

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

- [ ] **Demo on the deployed Vercel URL:** walk every Phase-1 surface (board,
      backlog, history, map/timeline/calendar, all three lenses) — consistent
      type scale, spacing, and palette throughout; no unstyled native controls
      anywhere.
- [ ] `docs/guidelines/design-system.md` committed: tokens, the palette with
      when-to-use guidance (semantic vs brand vs gradients), and a component
      inventory (primitives + composites).
- [ ] **Enforcement green:** no raw color literals (hex/rgb/hsl) in app code
      outside the token definitions (lint/grep wall, same spirit as the purity
      wall); text, inputs, and buttons render through the shared primitives.
- [ ] Documented text/background combos pass WCAG AA contrast; a
      `web-design-guidelines` review of the re-skinned surfaces has no
      unaddressed findings.
- [ ] **All M0–M4 e2e scripts green *unchanged*** — the milestone is purely
      presentational; selector-only test updates are acceptable, behavioral
      updates are a red flag.
- [ ] No `docs/contracts/CHANGELOG.md` entry needed — and that stays true (any
      contract change means scope crept).
- [ ] Retro note appended to this file.

## Explicitly out of scope

New features or behavior changes of any kind; dark mode; motion/animation
design beyond default transitions; a dedicated responsive/mobile redesign
(current breakpoint behavior just needs to not regress); print/export CSS
(deferred with the M4 lens export scope); extraction of the component set into
a published package; collaboration UX design (that's M8 planning); marketing or
landing pages. Adopting a component library (shadcn/radix) vs hand-rolled
primitives on Tailwind is a kickoff decision for Mitchell — hand-rolled is the
presumptive default; if a library is adopted, record it as an ADR.
