# M10 redesign delta — Implementation Plan (index)

> **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development`
> or `superpowers:executing-plans`. **Execute one phase file at a time**, in
> order. Do not read all phase files at once — each is written to be self-contained.

**Goal:** Bring the trip planner up to `design_handoff_update/current/`, building
every surface for real where the data model already supports it, and wrapping only
genuinely unbacked parts in the existing `<Preview>` treatment.

**Architecture:** Presentational work on top of the existing event-sourced core.
No new domain rules, no new commands, no new external services. Where the design
needs data, it comes from contracts that already exist (`ActivityView.cost`,
`trip.budget`/`currency`, `trip.backlog`, `Location.lat/lng`, and the
`time-overlap` / `over-budget` conflicts the domain already emits).

**Tech Stack:** Next.js 15 (App Router, Turbopack), React 19, Tailwind v4 with
`@theme` tokens, Radix primitives under `components/ui`,
`@atlaskit/pragmatic-drag-and-drop`, maplibre-gl + OpenFreeMap, Vitest +
Testing Library, Playwright.

## Phase files — execute in this order

| Phase | File | Tasks | Gate |
|---|---|---|---|
| 0 | `M10-delta/phase-0-blockers.md` | 3 | Trip page usable at every width |
| 1 | `M10-delta/phase-1-structure.md` | 4 | Navigation and header match the design |
| 2 | `M10-delta/phase-2-map.md` | 3 | Map view ships |
| 3 | `M10-delta/phase-3-rack.md` | 3 | Unscheduled rack ships |
| 4 | `M10-delta/phase-4-budget.md` | 2 | Cost and budget surfaced; KI-2 closed |
| 5 | `M10-delta/phase-5-overlaps.md` | 2 | Overlap warnings ship |
| 6 | `M10-delta/phase-6-growth.md` | 1 | Add-a-day and empty states ship |
| 7 | `M10-delta/phase-7-forms.md` | 2 | Add-stop and new-trip rebuilt |
| 8 | `M10-delta/phase-8-polish.md` | 7 | Accents, chips, badges, home, calendar |
| **8b** | `M10-delta/phase-8b-design-sync.md` | 5 | Caesura, sign out, save states, sync banner, calendar months |
| ~~**1b**~~ | `M10-delta/phase-1b-header-scope.md` | — | ~~The header adopts the focus-scope model~~ — **CANCELLED 2026-08-26, unbuilt** |
| 9 | `M10-delta/phase-9-gate.md` | 1 | Full DoD, docs, plan removal |

**Phases 8b and 1b were added 2026-08-23** from the design sync, as approved
amendments to M10's gate (recorded in `docs/milestones/M10-visual-craft.md`).
They run **after Phase 8**, in the order listed, before Phase 9. Phase 9's exit
checklist covers them too. **Phase 1b was cancelled 2026-08-26 without being
built** — `SPEC.md` §1's focus-scope model is rejected outright, so the gate
narrows back and Phase 9's checklist covers 8b only. Everything else the sync brought is routed out of
M10 — see `docs/design-feedback/2026-08-23-design-sync-review.md` §6.

**Dependencies.** Every phase depends on **0 and 1** being merged. Beyond that:
Phase 3 depends on 1 (the rack's clearance offsets assume the final header);
Phase 6 depends on 3 (its empty-day copy references dropping onto a day) and on
8's gap threshold for one bullet, which it says to skip if 8 has not landed;
Phase 7 depends on 3 (`fitIntoDay`). Phases 2, 4, 5 and 8 are independent of each
other. **Phase 8b** depends on 8 (Task 8b.5 restructures the calendar grid that
Task 8.6 restyles). ~~**Phase 1b** depends on 7 (Quick add opens Phase 7's
add-stop sheet) and on 8b (it absorbs 8b's account-menu island).~~ *(Moot —
Phase 1b cancelled.)*

**Two shared modules are created by whichever phase reaches them first.** Both
are verbatim moves out of `TimelineLens.tsx`, not new code, so doing the move
early is always safe:

| module | moved from | first needed by |
|---|---|---|
| `apps/web/src/lib/geo.ts` — `haversineKm` | `TimelineLens.tsx:127-135` | Phase 2 (Task 2.1) |
| `apps/web/src/lib/time.ts` — `toMinutes`, `toTimeString` | `TimelineLens.tsx:55-67` | Phase 3 (Task 3.1) |

If your phase needs one and the file does not exist yet, **do the move as your
first step** — take the function and its explanatory comment verbatim, update
`TimelineLens.tsx`'s import, and carry on. Never write a second copy: `geo.ts`'s
comment exists specifically to stop a third `haversineKm` appearing, since the UI
may not import `@tc/domain`.

---

## Global Constraints

Every task's requirements implicitly include this section. Values are copied
verbatim from the sources named.

### Source of truth

- **`.design-sync/handoff/design/Trip Planner Redesign.dc.html`** (3,524 lines,
  in-repo since 2026-08-23) is the design, with `.design-sync/handoff/SPEC.md`
  as its companion spec and `DRIFT.md` as the design↔build reconciliation.
  **Updated 2026-08-23:** this plan was written against a 2,623-line generation
  at `~/Downloads/design_handoff_update/current/`. That path does not exist in a
  fresh checkout or container — see this plan's KICKOFF, finding 3 — and the
  1,412 / 2,048 / 2,623 generations are unreadable from any session, so
  generation-diffing is over. Reconcile design against *code*, using
  `apps/web/src/lib/preview-registry.ts` as the spine for "not built yet".
  The in-repo file is **newer** than the one Phases 0-9 were written against; it
  adds a landing page, sign-in/sign-up, a first-run screen, an account menu, a
  Notebook redesign, and renames the product to Caesura. **None of that is in
  this plan's scope** — it is routed in
  `docs/design-feedback/2026-08-23-design-sync-review.md` §6, mostly to M11, M14
  and a proposed M15. Do not widen a phase to absorb it.
- Every literal design value needed by a task is **already inlined in that task**.
  You should not need to open the prototype. If a task seems to require a value it
  does not give you, stop and ask rather than inventing one.
- Read the prototype (if you do open it) as intent, never as markup to copy.
  `<sc-for>`, `<sc-if>`, `{{ }}` and
  `<x-import component-from-global-scope="TravelCollabUI.X">` are a template
  runtime; `TravelCollabUI.X` maps 1:1 to `apps/web/src/components/ui/x`.

### Repo law (from `AGENTS.md`)

- The six invariants hold. Never write a projection directly — every mutation is
  a command through `dispatch`.
- **No UI module may import `@tc/domain`.** CI enforces it. If you need domain
  logic in the UI, either it is already exposed on `TripDetail`, or you write a
  small local copy with a comment explaining why (see `lib/geo.ts`).
- **No new contract fields, no new commands, no new domain rules in this plan.**
  Anything the design needs that we do not model gets a `<Preview>` wrapper.

### Styling law (from `docs/guidelines/design-system.md`)

- **No arbitrary Tailwind values.** `scripts/check-color-wall.mjs:28` fails the
  build on any line matching `className={?["'`][^"'`]*\[` — so `z-[60]`,
  `w-[268px]` and `bg-[#fff]` are all build failures.
- **No raw color literals** (`#hex`, `rgb(`, `hsl(`) outside `globals.css` and
  `lib/sparklineColor.ts`.
- Genuine one-off geometry uses an inline `style` prop plus
  `// eslint-disable-next-line no-restricted-syntax`, with a comment saying why
  no token fits. Precedent: `TimelineLens.tsx:172`, `DayChips.tsx:120`.
- Anything needing a media query or a value outside Tailwind's scale becomes a
  **named class in `globals.css`**. Precedent: `.assistant-rail-scrim`,
  `.trip-board-content`, `.hero-grid`.
- **Tailwind's JIT cannot see interpolated class names.** An `AccentFamily` →
  class mapping must be a static `Record`. Precedent: `DayChips.tsx:19` `CHIP_BG`.

### Currency

Currency is a **trip-level** property, never per-event (Mitchell, 2026-08-14).
`Money` is `{ amountMinor: number, currency: string }`, but within one trip every
amount shares `trip.currency`. So every rollup sums `amountMinor` directly and
formats once with `trip.currency`. **Do not** write per-amount currency
branching, conversion, or a mixed-currency fallback — dead code guarding a state
the product does not produce.

Note the contract asymmetry: `cost` is `Money.optional()` on `ActivityView`
(`packages/contracts/src/activity.ts:65`) but `Money.nullable().optional()` on the
update command (line 79). "No cost" therefore arrives as `undefined` **or**
`null` depending on the path — handle and test both.

### Preview seam

- Every `<Preview id>` must exist in `apps/web/src/lib/preview-registry.ts`, and
  every registry entry must be used at least once.
  `apps/web/src/lib/preview-registry.test.ts` enforces both directions and will
  fail the build otherwise. **Adding a `<Preview>` means adding its registry
  entry in the same commit.**
- `size="compact"` = small construction-icon badge, for controls.
  `size="container"` = dotted border + `Preview · <milestone>` chip, for regions.

### Commands and verification

- Run from the repo root unless a task says otherwise.
- Unit tests: `pnpm --filter web test` (config `vitest.unit.config.ts`).
  A single file: `pnpm --filter web vitest run -c vitest.unit.config.ts <path>`.
  **`pnpm --filter web test:int` is the integration suite and needs real
  Postgres — do not run it per task, only at the gate.**
- Definition of Done per `AGENTS.md`: `pnpm typecheck`, `pnpm lint`,
  `pnpm --filter web test` green before a task is considered done.
- **Commit at the end of every task**, Conventional Commits style.

---

## File Structure

**New files**

| File | Responsibility |
|---|---|
| `apps/web/src/components/AppHeader.tsx` | Global top bar (mark, Trips/Playbooks nav, New trip, avatar) |
| `apps/web/src/lib/geo.ts` | `haversineKm` — hoisted out of `TimelineLens.tsx` |
| `apps/web/src/lib/time.ts` | `toMinutes` / `toTimeString` — hoisted out of `TimelineLens.tsx` |
| `apps/web/src/lib/cost.ts` | `tripSpend` / `daySpend` rollups |
| `apps/web/src/lib/place.ts` | `shortPlace` — city-or-first-segment |
| `apps/web/src/components/trip/TripMetaPill.tsx` | Header bordered meta pill |
| `apps/web/src/components/trip/BudgetChip.tsx` | Header bordered budget chip |
| `apps/web/src/components/trip/UnscheduledRack.tsx` | Sticky bottom drawer |
| `apps/web/src/components/trip/unscheduledRack.ts` | `fitIntoDay` time-fitting |
| `apps/web/src/components/trip/EndOfTrip.tsx` | End-of-timeline add block |
| `apps/web/src/components/lenses/MapRail.tsx` | Floating 268px day rail |
| `apps/web/src/components/lenses/MapFocusCard.tsx` | Focused-day card + legend |
| `apps/web/src/components/lenses/mapRailData.ts` | Per-day totals, bars, route geometry |
| `apps/web/src/components/lenses/OverlapWarning.tsx` | Inline overlap warning |
| `apps/web/src/components/lenses/overlapData.ts` | `time-overlap` → warning model |
| `apps/web/src/components/home/NewTripWizard.tsx` | 4-step wizard |

**Principal modifications**

| File | Phase | Change |
|---|---|---|
| `components/assistant/AssistantRail.tsx` | 0 | Scrim becomes a real dismiss control |
| `components/ui/sheet.tsx`, `ui/dialog.tsx` | 0 | Stack above the rail |
| `components/board/TripBoardScreen.tsx` | 0,1,3 | Rail visibility, header composition, rack mount |
| `components/trip/TripHeader.tsx` | 1 | Meta pill, budget chip, actions, tabs + chips inside sticky |
| `components/trip/TripViewTabs.tsx` | 1 | Four tabs, "More" removed |
| `app/layout.tsx` | 1 | Global header |
| `components/lenses/MapLens.tsx` | 2 | Full-bleed, per-day routes, rail, camera |
| `components/board/Board.tsx`, `Column.tsx` | 3,5,6 | Backlog retired, overlap chip, trailing column |
| `components/lenses/TimelineLens.tsx` | 4,5,6,7,8 | Cost, overlaps, empty days, legs, route line |
| `components/trip/SettingsSheet.tsx` | 4 | Rebuilt to the design |
| `components/trip/editor/ActivityEditorSheet.tsx`, `board/ActivityEditor.tsx` | 7 | Add-stop rebuilt |
| `lib/dayAccent.ts` | 8 | Collision probing + neutral |
| `app/page.tsx`, `home/*` | 8 | Rhythm, hero, trip cards |
| `app/globals.css` | 0,1,3,8 | Named classes for overlay, header, rack, offsets |
| `docs/known-issues.md` | 1,8,9 | Deliberate gaps |

---

## What ships real vs. marked incomplete

Decided by Mitchell, 2026-08-14: *"build upon what exists in the data model, and
implement the UI only for things we can't build today and wrap in the under
construction UI."*

**Real** — the unscheduled rack incl. drag both ways and time-fitting
(`trip.backlog` + `MoveActivity`); budget and per-stop costs (`ActivityView.cost`,
`trip.budget`, `trip.currency`); overlap warnings with the one-click fix
(`time-overlap` conflicts + `DismissConflict`); "Add a day" (`AddDay`); empty-day
states; the per-day map with routes (`Location.lat/lng`); add-stop's
day/start/duration/cost; the new-trip wizard's name, dates and budget.

**`<Preview>`-wrapped** — the `est` confirmed-vs-estimate marker; rack provenance
and "Was on Day X"; the Booked/Holds/Travel budget breakdown categories; invite
roles and "Invite someone"; the map legend's on-foot-vs-transit split; add-stop's
"who is in" and suggested places; the wizard's destination chips, pace, tags and
assistant-draft; "Add a saved day" (M11).

---

## Deliberate deferrals — do not implement, do not "fix"

- **Routing.** LocationIQ directions works on the existing key (probed
  2026-08-14: walking route returns GeoJSON, 1342.1 m / 982.3 s) but needs a
  server route, a cache and a rate-limit strategy. Phase 8's leg-line change
  removes the design's dependency on transport data anyway. Map routes are
  **straight lines**.
- **Contract growth.** Confirmed-vs-estimate cost state, "was on day N"
  provenance, invite roles, per-stop attribution, a true "area" field, and a
  start date on `TripSummary` are all absent by decision. Preview them.
- **The M10 presentational-only rule is already broken on this branch** (diffs
  exist in `apps/web/src/server/geocoding`, `packages/contracts/src/activity.ts`,
  `packages/domain/src/trip/conflicts.ts`). This plan adds no further `packages/`
  or `src/server` changes. If a task appears to need one, **stop and ask**.
