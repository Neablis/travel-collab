# Test suite inventory (Phase 0, Tasks 0.1–0.3)

Input to `docs/plans/test-overhaul/phase-5-prune.md`. Produced 2026-08-23 on
branch `claude/next-phases-work-vni3iz` at `be512c5`.

**Nothing here has been deleted.** This is a proposal with evidence attached.
Phase 5 executes it, behind M10 Wave 2's gate, with its own safety protocol.

---

## Method — two passes, because one is not enough

**Pass 1 — coverage (deterministic).** Every one of the 131 unit/property test
files was run **in isolation** with v8 coverage, and the per-file statement maps
intersected. `scripts/coverage-overlap.mjs` does this
(`collect` ≈ 9 min, `report` instant; raw maps in `.coverage-overlap/`, which is
gitignored). This answers *which test files execute the same source statements* —
mechanically, with no judgment.

**Pass 2 — intent (judgment).** Every test's name and, where the verdict was
close, its body. This answers *what regression would this catch*.

### Why both — and a worked example of coverage lying

Coverage says a line **ran**. It does not say a test would **notice that line
changing**. Two concrete failures of the coverage-only approach, both real, both
from this dataset:

1. **Scope.** The first version of the overlap script measured each test's
   *whole* footprint. Every domain test transitively loads
   `evolve`/`decide`/`contracts`, so `equality.test.ts` scored **0% unique,
   100% overlapped** and looked deletable — while `tripStatesEqual` is asserted
   **nowhere else in the repo**. Shared imports drown the signal. Fixed by
   scoping every comparison to the source file a test is named after.

2. **Assertion value, which no scoping fixes.** Even scoped, the report says
   `formatMoney.test.ts` is **100% subsumed by `page.test.tsx`**. It is not
   redundant: `page.test.tsx` merely *executes* those 11 statements while
   rendering a trip card; `formatMoney.test.ts` is the only place that asserts
   the *output string* (`"1,111,106.00 USD"`) — the KI-2 grouping guarantee.
   Coverage is structurally blind to this. Same false positive for
   `dayAccent.test.ts`, `sparklineColor.test.ts`, and ~12 others.

**So: coverage narrowed 131 files to 66 candidates; intent decided which of the
66 were real.** Roughly half were false positives. Mutation testing (Phase 5
Task 5.3) is the instrument that closes the remaining gap — it answers "would
deleting this lose fault detection" directly, which is why Phase 5 already
scopes Stryker to the four load-bearing domain modules.

### The finding that changes how Phase 5 should read the data

In **16 of the 66** subsumption pairs, the "subsumed" file is a **pure-function
test at the correct layer** and the subsumer is an **expensive component test**:

| pure test (subsumed) | subsumer (component) |
|---|---|
| `mapRailData.test.ts`, `mapData.test.ts`, `mapRailTuning.test.ts` | `MapLens.test.tsx` |
| `mapRailFocus.test.ts` | `MapRail.test.tsx` |
| `calendarData.test.ts` | `CalendarLens.test.tsx` |
| `timelineData.test.ts` | `TimelineLens.test.tsx` |
| `sparklineColor.test.ts` | `NextTripHero.test.tsx` |
| `itineraryData.test.ts`, `tripOverviewData.test.ts`, `dailyOverviewData.test.ts`, `formatDate.test.ts`, `budget-meter.test.tsx`, `page-container.test.tsx` | `TripBoardScreen.test.tsx` |
| `optimistic.test.ts` | `TripProvider.test.tsx` |
| `pagesClient.test.ts` | `NotebookScreen.test.tsx` |
| `segmented-control.test.tsx` | `PlaybooksScreen.test.tsx` |

**Cut the subsumer's re-proof, not the pure test.** The pure test is node-env,
runs in single-digit milliseconds, and is at the layer the plan's Principle 2
names. The component test is a jsdom render costing ~600ms of environment setup
to prove the same arithmetic. Coverage identifies the *pair*; the layer rule
decides the *direction*, and it points the opposite way from what the raw table
suggests. **Phase 5 must not read column C as a delete list.**

---

## Headline numbers

| Suite | Files | Tests | Test LOC | Verdict summary |
|---|---|---|---|---|
| `packages/contracts` | 7 | 43 | 478 | keep all — dense, layer-correct, ~1s |
| `packages/domain` | 22 | 129 | 2,259 | keep all but 1 merge — this is the model suite |
| `packages/pages` | 7 | 26 | 316 | keep 24, cut 2 |
| `apps/web` unit | 95 | 569 | ~9,800 | **the entire problem lives here** |
| `apps/web` int | 12 | ~87 | ~1,550 | keep, with one merge (authz) |
| `apps/web` e2e | 11 | 18 | 1,240 | keep all; +1 from Phase 3 |

**Proposed net: −168 tests (≈19% of 864), −~2,600 test LOC, −24 jsdom files.**

The count matters less than *which* 24 files stop constructing a jsdom world:
that is roughly 15s of the unit suite's 43s, on top of Phase 1's environment
split. **No target was set** (Mitchell, 2026-08-23) — this is what the criteria
produced.

---

## Cross-cutting findings

### 1. `mocks/fixtures.ts` is executed by 24 different test files

The single most-shared non-`ui` module in the repo. Empirical confirmation of
Phase 2's premise: this is the seam where one factory change reaches a quarter
of the suite. It also means Phase 2's migration is the highest-blast-radius
change in the plan — do it in one commit, not incrementally.

### 2. The Preview-shield assertion is re-proved 13 times across 9 files

`ui/preview.test.tsx` proves once that `<Preview>` inerts its children.
Then `ShareButton`, `KeepDayDialog`, `InsertPlaybookDialog`, `AddSavedDayButton`
(2 each), plus `TripHeader`, `PlaybooksScreen`, `WorthYourAttention`,
`PlaybooksStrip`, `GhostProposal` (1 each) re-prove it through a rendered
component. Coverage confirms: every one is ≥100% subsumed on its own subject.

**Keep one per component only where the component decides *whether* to wrap**
(`MapLegend` — real key outside the Preview, mode keys inside — is a genuine
claim). Cut the rest: **−11 tests.**

### 3. `401/403` is asserted 8 times across 3 route files

`route.int.test.ts`, `pages/route.int.test.ts` (×2 describe blocks) and
`ai/route.int.test.ts` each hand-roll "401s when unauthenticated" / "403s for a
non-member". **Merge into one table-driven authz suite over every endpoint** —
that is *better* coverage (it would catch a new endpoint shipping without a
guard, which none of the 8 currently do) in fewer lines. **−6 tests, +1.**

### 4. `TripBoardScreen.test.tsx` is load-bearing far beyond its name

It is the **sole** coverage for four components with no test file of their own:
`ItineraryLens.tsx` (94 stmts), `ActivityEditorSheet.tsx` (88),
`FullTripOverviewLens.tsx` (47), `DailyOverviewLens.tsx` (43). It is also the
top subsumer for 20+ other files.

**Hard keep, and its 581 lines are not the bloat they look like.** Merge a few
overlapping renders (the three rail-visibility tests), but do not shrink it on
size alone — this is exactly the judgment the raw LOC ranking would have gotten
wrong, and only the coverage pass surfaced it.

### 5. `dayAccent.test.ts` passes while KI-18 is broken

`it("spreads distinct cities across families")` is green today, and KI-18 records
that **7 of 13 real city names collide onto `danger`**. The test asserts
something weaker than the property its name claims. It is not redundant — it is
**wrong**, and it is giving false confidence on a known-broken function.
Verdict: **rewrite as a property test** (Phase 6 Task 6.5), not cut.

### 6. `sparklineColor.ts` already solves KI-18 — hand this to the M10 builder

Unrelated to testing, found while reading the pair. `sparklineColor.ts`'s header
documents that it **deliberately replaced a per-city djb2 hash mirroring
`dayAccent.ts`**, because "independent hashes collide — a real 14-day Japan trip
rendered Tokyo, Hakone and Kyoto in one identical orange." That is KI-18, and
`sparklineColorsFor()` is a working reference implementation of the fix
(whole-trip resolution, first-appearance assignment) with the reasoning already
written down.

**M10 Wave 2 Phase 8 Task 8.2 should read `sparklineColor.ts` before writing
`dayAccents(cities)`.** Worth a note in the KI-18 entry regardless of this plan.

---

## Verdicts by area

Legend: **keep** · **merge** (fold into a named file) · **cut** · **rewrite** ·
**M10** (blocked — re-inventory after M10 Wave 2, per the plan's Sequencing)

### `packages/*` — keep, essentially in full

The model suite. Dense, correctly layered, node-env, 2.6s for all 129 domain
tests. Two exceptions:

| file | tests | verdict | why |
|---|---|---|---|
| `pages/src/result.test.ts` | 3 | **cut** | three one-line `MacroResult` constructors; TypeScript proves this |
| `pages/src/registry.test.ts` | 5 | **merge → 4** | "registers all seven starter macros" duplicates `registry.property.test.ts`'s "covers all N registered macros" |
| everything else | 190 | **keep** | — |

**Do not touch `anchor-conflicts.test.ts` / `anchors-state.test.ts`.** They look
orphaned (the anchors UI was retired in M8) but are the deliberate **D-1
tripwire** — `docs/known-issues.md` says a future change that breaks anchors
must fail the build so someone *decides* rather than reflexively repairing. A
prune pass reading only coverage would delete these.

**Net: −4 tests.**

### `apps/web/src/components/ui` — the densest cut zone

9 files, 32 tests, 424 LOC. Almost entirely `className` assertions.

| file | tests | verdict | why |
|---|---|---|---|
| `primitives.test.tsx` | 4 | **cut all** | asserts `<h2>` renders `<h2>`, and Tailwind classes. The color wall lint owns this contract, exhaustively and without a DOM |
| `page-container.test.tsx` | 3 | **cut all** | max-width classes |
| `segmented-control.test.tsx` | 2 | **cut all** | "moss track", "raised pill" — pure styling. Behavior is covered by `navigation.test.tsx` |
| `budget-meter.test.tsx` | 2 | **merge → 1** | keep the over-budget *clamp* (real logic); drop the color assertion |
| `composites.test.tsx` | 5 | **merge → 2** | keep FormField label→control wiring + Banner-is-warning-not-danger (a deliberate product rule); cut "Dialog opens", "Tabs switch" (Radix's job) |
| `preview.test.tsx` | 4 | **merge → 2** | keep "inerts interactive controls" + `aria-disabled` — load-bearing for 13 other tests; cut the chip/compact-badge renders |
| `overlays.test.tsx` | 4 | **merge → 2** | cut the two "opens on click"; **keep both stacking tests — they are the KI-17 regression guard** |
| `navigation.test.tsx` | 2 | **keep** | roles + `onValueChange`: behavior and a11y |
| `toast.test.tsx` | 6 | **merge → 4**, **rewrite** | the last three (duration survives re-render with a new inline `onDismiss`; timer restarts on message change) are subtle real bugs — keep. Move to fake timers (Phase 4) |

**Net: −14 tests, −3 jsdom files.**

### `apps/web/src/components/board`

| file | tests | verdict | why |
|---|---|---|---|
| `board.test.tsx` | 14 | **merge → 9** | cut 5 pure-styling: "268px wide, rounded-2xl", "cards use 12px padding", "lay out in a horizontally scrolling row", "drop area fills the card with a minimum height", "carries no hover highlight" |
| `MoneyInput.test.tsx` | 12 | **keep all**, **rewrite** | the model file of the repo — every test names a distinct real bug (no commit per keystroke, flush on unmount, don't clobber in-progress typing). KI-13's canonical slow file: 11,675ms in-suite vs 191ms alone → fake timers |
| `TripBoardScreen.test.tsx` | 19 | **merge → 17**, **M10** | see finding 4. Merge the three rail-visibility tests to one parametrized case |
| `TripMoneySettings.test.tsx` | 1 | **merge → `SettingsSheet.test.tsx`** | 100% subsumed; one test, same surface |
| `ActivityEditor.test.tsx` | 2 | **M10** | Phase 7 rewrites the component *and this file*. Do not touch |
| `LocationInput.test.tsx` | 4 | **keep** | real geocode wiring incl. the Enter-doesn't-submit-the-form bug |
| `HistoryPanel.test.tsx` | 3 | **keep** | paging + preview-exit are real |
| `UndoRedoControls.test.tsx` | 4 | **keep** | the double-click-while-busy test is a real guard |
| `resolveDrop.test.ts` | 7 | **keep** | pure drag logic, extracted precisely because jsdom has no `DataTransfer` |

**Net: −7 tests.**

### `apps/web/src/components/lenses`

| file | tests | verdict | why |
|---|---|---|---|
| `ScheduleLens.test.tsx` | 2 | **cut all** | "renders TimelineLens when view=Timeline" — a switch statement. 100% subsumed |
| `MapRail.test.tsx` | 12 | **merge → 7** | cut the 5 that re-prove `mapRailFocus.ts`'s math through a render (reaches every day, last day at bottom, gearing, no-manufactured-travel). Keep the component-level ones: coalesces a burst, no re-emit, no focus on mount |
| `MapLens.test.tsx` | 10 | **merge → 6** | fold the 4 marker-ghosting cases into 1–2; they assert opacity values against a mocked maplibre |
| `MapLegend.test.tsx` | 2 | **keep** | real-vs-Preview split is a genuine claim (finding 2's exception) |
| `MapFocusCard.test.tsx` | 3 | **merge → `MapLens.test.tsx`** | 100% subsumed, 31 stmts |
| `mapRailTuning.test.ts` | 5 | **merge → 2** | a dev tuning store; keep defaults + subscribe/unsubscribe |
| `TimelineLens.test.tsx` | 15 | **M10** | touched by M10 phases 5, 6 **and** 8. 13 `getByText`, the canonical brittleness case. Re-inventory after |
| `CalendarLens.test.tsx` | 5 | **M10** | touched by M10 phases 6, 8 |
| `TripDateControl.test.tsx` | 7 | **keep** | shrink-confirm and external-resync are real; closed D-2 |
| `mapRailFocus.test.ts` | 15 | **keep** | pure, node-env, the correct layer (see the inverted-direction finding) |
| `mapRailData` · `calendarData` · `timelineData` · `itineraryData` · `mapData` · `tripOverviewData` · `dailyOverviewData` · `formatMoney` | 21 | **keep all** | pure, node-env, milliseconds. Coverage flags them as subsumed; that reading is inverted |

**Net: −12 tests, −2 jsdom files.**

### `apps/web/src/components/trip`

| file | tests | verdict | why |
|---|---|---|---|
| `Sparkline.test.tsx` | 20 | **merge → 16** | `shapeOf`/`blockMetricsFor`/`citySegmentsFor` (13) are real pure logic — keep. Cut 4 component tests that re-render what `shapeOf` proved ("colors a day's blocks by that day's city") |
| `TripViewTabs.test.tsx` | 10 | **merge → 2** | five "selects X when lens=Y" + four "clicking X calls setLens" is one derivation table tested ten ways. Two `it.each` tables |
| `ShareButton.test.tsx` | 5 | **merge → 1** | Preview + inert (finding 2) + two `className` variant assertions |
| `KeepDayDialog.test.tsx` | 3 | **merge → 1** | Preview + inert |
| `AddSavedDayButton.test.tsx` | 3 | **merge → 1** | Preview + inert |
| `InsertPlaybookDialog.test.tsx` | 4 | **merge → 2** | keep the reflow-to-09:00 preview (real logic); cut Preview + inert |
| `DayChips.test.tsx` | 8 | **merge → 6**, **M10** | `chipModel`'s 5 are real (city transitions, null-date fallback). Cut 2 thin component renders. M10 phase 8 touches `DayChips.tsx` |
| `SettingsSheet.test.tsx` | 11 | **keep** (+1 from `TripMoneySettings`) | delete/duplicate/date flows are real |
| `TripHeader.test.tsx` | 13 | **M10** | M10 phase 6 touches it. 313 LOC |
| `BudgetChip.test.tsx` | 4 | **merge → 3** | cut "opens settings when clicked" (covered by `SettingsSheet`) |
| `UnscheduledRack.test.tsx` | 7 | **keep** | the drawer's own disclosure/empty-state behavior; `unscheduledRack.test.ts` covers the *fitting* math separately and correctly |
| `SyncIndicator` · `TripMetaPill` · `KeepDayFlag` · `FocusProvider` | 9 | **merge → 6** | one Preview/inert each in `KeepDayFlag`; rest keep |
| `context.test.tsx` · `TripProvider.test.tsx` · `optimistic.test.ts` · `rackDisclosure.test.ts` · `unscheduledRack.test.ts` | 27 | **keep all** | the optimistic/predict spine — KI-5's surface. `optimistic.test.ts` is pure and stays |

**Net: −22 tests, −3 jsdom files.**

### `apps/web/src/components/{home,pages,assistant,playbooks}`

| file | tests | verdict | why |
|---|---|---|---|
| `NextTripHero.test.tsx` | 12 | **merge → 8**, **M10** | the loading / fetch-failed / no-budget "never fabricate" trio is one parametrized honesty test. M10 phase 8 rewrites the home hero |
| `PlaybooksStrip.test.tsx` | 4 | **merge → 1** | "renders a card per fixture entry" and "renders exactly one card per fixture item" are the same assertion twice; plus Preview |
| `WorthYourAttention.test.tsx` | 4 | **merge → 1** | identical duplication |
| `PlaybooksScreen.test.tsx` | 5 | **merge → 2** | Preview + fixture-count duplication |
| `TripCard.test.tsx` | 6 | **keep** | human-readable date (a real filed complaint) and honest-absence are real |
| `AssistantRail.test.tsx` | 14 | **merge → 11** | cut the two quick-ask/suggestion Preview-shield re-proofs and one badge case. **Keep "does not leave an inert pointer-blocking layer over the page" — that is the KI-16 guard** |
| `GhostProposal.test.tsx` | 3 | **merge → 1** | keep the unwrapped real-handler-wiring test; cut two Preview re-proofs |
| `PageScreen` · `NotebookScreen` · `MacroView` · `ComposePanel` · `PageEditor` · `MacroNodeExtension` | 17 | **keep** | the Notebook surface is thinly covered already; nothing to spare |

**Net: −16 tests, −2 jsdom files.**

### `apps/web/src/{lib,server,app}` — keep almost everything

The AI layer (`batchResolver` 26, `geocodeEnrichment` 25, `context` 13,
`geocodeRegion` 13, `planningTools`, `pageTools`, `modelSelection`) is the
best-tested code in the repo: node-env, fast, and every test names a real
invariant. `batchResolver.test.ts`'s "rejected orderings stay rejected" block
**pins KI-10's design decision in executable form** — untouchable.
`geocodeEnrichment.test.ts` is KI-15's regression suite — untouchable.

| file | tests | verdict | why |
|---|---|---|---|
| `lib/dayAccent.test.ts` | 4 | **rewrite** | finding 5 — passes while KI-18 is broken |
| `app/page.test.tsx` | 9 | **merge → 7**, **M10** | the three planned-of-budget honesty cases parametrize to one. M10 phase 7/8 touch `app/page.tsx` |
| `app/api/**/route.int.test.ts` | ~49 | **merge → ~44** | finding 3 — one table-driven authz suite (−6, +1) |
| everything else | ~150 | **keep** | — |

**Net: −13 tests.**

---

## Blocked on M10 Wave 2 — re-inventory, do not execute

Eight files whose components M10 Phases 5–8 rewrite. Verdicts above are
provisional; re-run this inventory against the post-M10 tree.

`TimelineLens.test.tsx` · `ActivityEditor.test.tsx` · `NextTripHero.test.tsx` ·
`DayChips.test.tsx` · `CalendarLens.test.tsx` · `TripHeader.test.tsx` ·
`board.test.tsx` · `app/page.test.tsx`

---

## What is NOT done here (residual Phase 0 work for the builder)

- **Task 0.1 — the three-run protocol.** Recorded numbers so far are *single*
  runs on a 4-core sandbox: web unit 95 files/569 tests/**43.1s**
  (`environment 58.7s`, `tests 22.5s`); domain 22/129/**2.6s**
  (`environment 4ms`). KI-13 says single runs lie. Re-run ×3 with `ps aux`
  recorded, and add `test:int` and `test:e2e:ci-like`, which were never timed
  (no Postgres in this sandbox).
- **Task 0.2 — done.** 35 of 95 web unit files are node-safe; the four
  `.ts` files that are *not*, with reasons, are listed in
  `phase-1-config.md` Task 1.1. Verified empirically, not by heuristic.
- **Task 0.4 — the domain coverage floor.** `@vitest/coverage-v8` is now
  installed in all four packages (this inventory needed it), so this is one
  command: `pnpm --filter @tc/domain exec vitest run --coverage`. Record line
  and branch percentages for `src/trip/*.ts` before Phase 5 touches anything.
- **Mutation baseline.** Phase 5 Task 5.3's Stryker run on `decide.ts`,
  `evolve.ts`, `conflicts.ts`, `diff.ts`. Not started.

## Reproducing this

```bash
node scripts/coverage-overlap.mjs collect          # ~9 min, all 131 files
node scripts/coverage-overlap.mjs collect domain   # or one suite
node scripts/coverage-overlap.mjs report           # instant, reads the maps
```

Section A = over-tested source files. Section B = sole-coverage (hard keeps).
Section C = subject-scoped subsumption — **candidates, not a delete list**; read
the inverted-direction finding above before acting on any row.
