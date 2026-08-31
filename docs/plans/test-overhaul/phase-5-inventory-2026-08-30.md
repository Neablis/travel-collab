# Phase 5 re-inventory — 2026-08-30

`phase-5-prune.md` opens with a precondition: *"Re-run the Phase 0 inventory
against the post-M10 tree before executing."* This is that re-run. It executes
nothing. It exists so the prune, when it happens, argues from the tree in front
of it rather than from `docs/testing-inventory.md`, which predates M10 Wave 2
Phases 5-8 and every M11 link.

## 1. The suite tripled while the prune sat gated

Phases 0-4 landed 2026-08-23. Phases 5-7 were gated on M10 Wave 2's gate, which
**closed 2026-08-27**; nothing resumed (`TODO.md`, "Deferred work with a resume
condition that has already fired"). Measured per first-parent commit on `main`,
counting `it(`/`test(` blocks under `apps/web/src`:

| date | commit | files | tests |
|---|---|---|---|
| 2026-08-22 | `8c2d11e` | 95 | 648 |
| 2026-08-25 | `194fb66` | 104 | 841 |
| 2026-08-27 | `4fd3f67` | 111 | 968 |
| 2026-08-28 | `d41af2e` | 123 | 1,338 |
| 2026-08-30 | `1d44973` | **138** | **1,908** |

Against the overhaul's own baseline of **95 files / 569 tests**, the suite is
now **3.3× the test count it was launched to reduce.** The web *unit* lane
alone (the `vitest.unit.config.ts` include set, excluding `.int.test.*`) is
**140 files / 1,590 tests / 26,412 LOC**.

The single largest jumps are `a109eb7` (M11 sharing/invites, +227 tests) and
`848581b` (+401). Neither is a defect — they are real features with real
coverage. The point is only that nothing has ever pulled the other way.

## 2. What the vacuity greps say: the suite is not padded

Checked first, because "too many tests" and "too many *worthless* tests" are
different claims and only the second justifies deleting anything. Across 195
files / 2,015 tests / 5,389 assertions repo-wide:

- **1** skipped test, **0** tautologies (`expect(true).toBe(true)`)
- 489 `toBeDefined`/`toBeTruthy` (9% of assertions) and 362 `toHaveBeenCalled*`
  (7%) — normal ratios, and most of the former are guards before a stronger
  assertion

**Conclusion: there is no vacuity problem.** Anyone arriving here looking for
dead weight to delete on quality grounds will not find much. The prune's case
is redundancy and brittleness, which is what `phase-5-prune.md` always said and
what the rest of this document measures.

**Three real exceptions**, and they are the vacuity class `.coderabbit.yaml`
already names — *a property that asserts on no generated case still reports
green*. These `fast-check` files carry no `witness` floor:

- `packages/domain/test/conflicts.test.ts`
- `packages/domain/test/costs.property.test.ts`
- `packages/domain/test/dates.property.test.ts`

These are the only tests in the repo that might currently be proving nothing.

**Fixed 2026-08-30.** All nine `fc.assert` blocks across the three files now
carry a witness. Four of them were genuinely at risk and tick per *unit of real
work* rather than per run, because per-run ticking would have hidden the exact
failure it is meant to catch:

| property | ticks on | floor | observed |
|---|---|---|---|
| `conflict subject pairing` | each conflict examined (`.every` on `[]` is vacuously true) | 130 | 266-334 |
| `conflict id order-invariance` | runs where the forward pass found a conflict (`"[]" === "[]"`) | 24 | 49-64 |
| `consecutive day spacing` | each day-pair comparison (`n === 1` skips the loop) | 1180 | 2370-2943 |
| `cost partition` | runs carrying a real cost (`0 + 0 === 0` holds for anything) | 43 | 86-92 |
| `null start propagates` | runs with `n > 0` | 46 | 93-97 |
| `shift round-trip` | runs with `k != 0` | 46 | 93-99 |
| `windowsOverlap symmetry`, `haversine metric laws`, `costless trip totals 0` | every run (no guard) | 100 | exactly `numRuns` |

Floors were **measured over five runs and set near half the observed minimum**,
per AGENTS.md. Flap check: **0 of 10 runs** hit a floor.

**Proven non-vacuous**, which is the only evidence that matters here: starving
each generator (`maxLength: 6` → `0`, `max: 60` → `1`, `max: 100_000` → `0`)
makes exactly the four at-risk properties fail with
`ran 0 assertion(s), expected at least N`. Before this change those same starved
generators passed green.

One real defect fell out of the audit. `dates.property.test.ts` asserted
`expect(there).not.toBe(base)` — a **tautology**: two `deriveDayDates` calls
always return different array objects, so it held even if the shift did
nothing. It now asserts `not.toEqual(base)`, guarded on `k !== 0`, which is the
claim the test's name makes.

## 3. Cross-layer overlap — method, and its one flaw

The question is which component tests re-assert what an e2e spec already walks.
Mechanically: extract every `getBy*`/`findBy*`/`queryBy*` target string from
`e2e/*.spec.ts` (169 distinct), do the same per component test, and intersect.

**Rank by absolute overlap, never by percentage.** The percentage form
over-ranks any file with a small selector vocabulary, and it produced a
confident false positive on the first pass — see `MapLens` below. Absolute
counts, top of the list:

| shared targets | tests | distinct targets | file |
|---|---|---|---|
| 47 | 49 | 80 | `board/TripBoardScreen.test.tsx` |
| 15 | 14 | 26 | `trip/TripHeader.test.tsx` |
| 12 | 47 | 56 | `lenses/TimelineLens.test.tsx` |
| 12 | 26 | 25 | `assistant/AssistantRail.test.tsx` |
| 12 | 13 | 20 | `access/SharedTripScreen.test.tsx` |
| 11 | 32 | 29 | `board/board.test.tsx` |
| 9 | 35 | 27 | `front/AuthScreen.test.tsx` |

**A shared selector is a candidate, not a verdict.** An e2e spec clicking "Add
activity" on its way somewhere else does not duplicate a component test that
asserts the button renders. Every row above needs reading before it is cut.
Two were read for this document:

- **`lenses/MapLens.test.tsx` — FALSE POSITIVE. Do not cut.** It scored 77% on
  the percentage metric off a 9-word selector vocabulary. Its 31 tests assert
  maplibre layer opacity, camera padding, marker ghosting and dim-compositing
  (*"takes the fainter of the day dim and the tag dim, never their product"*).
  Playwright cannot observe any of it. This file is the reason the percentage
  metric was discarded; it is recorded here so nobody re-derives the ranking
  and cuts it next quarter.
- **`trip/TripViewTabs.test.tsx` — TRUE POSITIVE, partially.** Four of its ten
  tests assert `setLens`/`setLensAndView` *mock calls* on tab click, which
  `e2e/m10-growth.spec.ts` and `e2e/m11-demo.spec.ts` prove for real by
  clicking all four tabs and asserting the resulting view. Three more are
  per-prop selection renders (§4). **But the last test is load-bearing:**
  *"gives every lens LensRouter accepts its own tab, and no tab is dead
  (KI-20)"* is an invariant guard with no e2e equivalent. Cutting this file
  wholesale re-opens KI-20.

## 4. Category (d) — per-prop render tests

`phase-5-prune.md` Task 5.1(d): files where each test renders once and asserts
one prop's effect, merged into one test that walks a real sequence. Detected as
`render()` calls >= test count, with >= 12 tests:

| tests / renders | file |
|---|---|
| 35 / 35 | `front/AuthScreen.test.tsx` |
| 23 / 23 | `trip/context/TripProvider.test.tsx` |
| 16 / 16 | `home/NextTripHero.test.tsx` |
| 16 / 16 | `lenses/MapRail.test.tsx` |
| 13 / 13 | `AccountMenu.test.tsx` |
| 13 / 13 | `access/SharedTripScreen.test.tsx` |
| 12 / 12 | `board/MoneyInput.test.tsx` |
| 12 / 12 | `trip/ShareButton.test.tsx` |
| 12 / 12 | `trip/TravelersPanel.test.tsx` |

152 tests across nine files — **and on reading them, category (d) does not
exist in this tree.** Five of the nine were read in full on 2026-08-30. None is
a per-*prop* file. Every one is a set of independent behavioural failures that
each happen to need their own render:

- **`front/AuthScreen.test.tsx`** — the "one render per test" shape here is
  well-isolated state testing, not bloat. Its tests carry comments recording a
  next-auth KI (an unregistered provider bounces client-side before Auth.js can
  emit `?error=`), a copy line that would assert something *false* in the
  Google-unavailable state, and the two `auth.setup.ts` selectors whose
  breakage fails the entire e2e lane at setup. Merging destroys that.
- **`board/MoneyInput.test.tsx`** — blur, Enter, Escape, unmount-flush,
  external re-sync, no-clobber-while-typing. Twelve independent behaviours of a
  controlled input.
- **`trip/TravelersPanel.test.tsx`** — invite create/copy/revoke, clipboard
  denied, error cleared on reload, failed revoke behind a successful reload.
- **`home/NextTripHero.test.tsx`** — 67 comment lines, and the whole file
  encodes one product invariant: never fabricate data. "Never fabricated bars",
  "honest unavailable placeholder", "an em dash, not a confident zero", "the
  real, live conflict count, not a hardcoded number."
- **`AccountMenu.test.tsx`** — reset confirmation, in-flight double-click
  guard, Escape mid-reset, inline failure without closing the dialog.

**The `render() >= tests` heuristic cannot tell "one render per prop" from "one
render per independent behaviour."** The second is what good isolation looks
like, and it is what these files are. This is recorded at length because the
heuristic is seductive, reproducible, and wrong here — the next person to run
it will get the same nine files.

`board/TripBoardScreen.test.tsx`, the plan's named flagship, is the same story.
The plan predicted "581 lines... several near-duplicate renders differing in
one prop." It is now 1,579 lines with **292 comment lines**, organised into
intent-scoped `describe` blocks (a viewer's board, approving a proposal, a
viewer's Schedule lens) that assert rollback semantics, batch counts, thread
ceilings and partial-stream answers — none of which Playwright can observe. Its
47-target overlap with e2e is because the board is *what e2e walks*, not
because the assertions duplicate.

**Category (d) yields nothing. Do not merge these files.**

## 5. Categories (a) and (b) have largely already been paid

- **(a) framework tests** (`.tagName`, bare `toHaveAttribute("href")`): **7**
  assertions repo-wide, in `ui/primitives.test.tsx` (3),
  `board/ActivityCard.test.tsx` (2), `ui/page-container.test.tsx`,
  `ui/composites.test.tsx`.
- **(b) `className` assertions**: **60** total, concentrated in
  `board/board.test.tsx` (16), `ui/primitives.test.tsx` (8),
  `ui/preview.test.tsx` (6). The plan was written against nine `ui/*.test.tsx`
  files that were "substantially this" (424 lines); that is no longer the
  shape. Still worth cutting, but be accurate about why:
  `scripts/check-color-wall.mjs` enforces that **raw color literals live in one
  file**, which is not the same ground as "this element carries `bg-brand`".
  The case against these assertions is brittleness — they break on every
  restyle — not exact duplication. A tidy-up, not a lever.
- **(c) domain re-proofs through the UI**: **no component test imports
  `@tc/domain`.** 23 import `@tc/factories`, which is what Phase 2 prescribes,
  so the mechanical grep finds nothing. Any real (c) case needs the assertions
  read, not the imports.

## 6. What this inventory does not establish

Stated so the prune does not inherit false confidence:

- Every row in §3 except the two named is **unread**. The overlap number is a
  reading queue, not a cut list.
- No coverage measurement was run (Task 5.3 check 1), and no mutation
  spot-check (check 2). Both are preconditions for deleting anything, and
  neither is satisfied by this document.
- `phase-5-prune.md`'s standing decision holds: **there is no deletion target.**
  Apply the criteria, report the number, and let it land where it lands.

## 7. Verdict: the prune is mostly obsolete

Applying the plan's own four categories to the tree in front of us, after
reading the candidates rather than ranking them:

| category | plan's expectation | what is actually there |
|---|---|---|
| (a) framework tests | a species worth sweeping | **7 assertions** |
| (b) `className` | nine files "substantially this" (424 lines) | **60 assertions**, brittleness not duplication |
| (c) domain re-proofs | mechanical via factories | **none** — no component test imports `@tc/domain` |
| (d) per-prop renders | the big lever | **none** — nine false positives, read and recorded above |
| cross-layer overlap | — | **one verified case**: 4 tests in `trip/TripViewTabs.test.tsx` assert `setLens`/`setLensAndView` mock calls that `m10-growth` and `m11-demo` prove by clicking all four tabs. Its KI-20 "no tab is dead" test must survive. |

The suite tripled because the product tripled, and the tests that arrived are
well-constructed — heavily commented, behaviourally isolated, asserting things
the layer above cannot see. **The volume is real; the waste is not.**

What that leaves is roughly 70 assertions and 4 tests of genuine cleanup, which
does not justify a prune PR on its own. The actual cost problem this
investigation started from was never the number of tests — it was **running all
of them for a one-file change**, which the tiered Definition of Done in
`AGENTS.md` now addresses directly.

Recommendation: close Phases 5-7 as **superseded** and let the verification
ladder carry the cost argument.

## 8. The cleanup that was actually executed (2026-08-30)

**`trip/TripViewTabs.test.tsx`: 10 tests -> 6.**
Four tests asserting `setLens`/`setLensAndView` *mock calls* on tab click were
deleted. `e2e/m10-growth.spec.ts` clicks all four tabs and asserts the lens that
actually renders — timeline rows, day columns, calendar cells, the map rail —
which proves the same wiring end to end and, unlike a mock assertion, cannot
survive the stub drifting from the real `useLens`. `m11-demo.spec.ts` walks
three of the four again. Four selection-state tests differing only in their
`(lens, view)` input were merged into one `it.each` table, which also pins which
tab each lens owns — something the KI-20 test deliberately does not assert.
KI-20's guard is untouched.

**`ui/primitives.test.tsx`: the plan's own quoted category-(a) example.**
`expect(h.tagName).toBe("H2")` was removed: the `getByRole("heading", { level: 2 })`
query directly above it already resolves by heading level, so the assertion
restated the query and could not fail independently.

The `Button` variant test was **rewritten rather than deleted.** The plan says
cut literal token assertions (`bg-brand`, `bg-danger`); the problem is that
`Button` exposes its variant *only* as classes — there is no `data-variant` — so
deleting left "the variant prop is wired at all" unguarded. It now asserts the
three variants produce **distinct** class strings and that the default equals
secondary. That catches the regression that actually happens (a variant silently
ignored or collapsed onto the default) and survives a retoken. **Proven
non-vacuous:** dropping `variant` from the `buttonVariants({ variant, size })`
call fails it with `expected 1 to be 3`.

**`board/board.test.tsx`: 32 tests -> 31.**
`"activity cards use 12px padding"` was deleted outright — a single `p-3`
assertion, no behavioural claim, breaks on any padding change. The trailing-
column test lost its `15px`/`font-semibold`/`text-ink` type tokens and kept what
is load-bearing: the trailing column is the *same width* as a real day column (a
mismatch is a visible layout break) and stays dashed (what marks it a
placeholder). It now asserts width **parity** rather than two independent
literals.

### What was deliberately kept, and why

The remaining ~45 `className` assertions were read and left alone. They are not
the category the plan describes — each carries a behavioural claim that has no
other expression in jsdom:

- `"day columns lay out in a horizontally scrolling row"` — `overflow-x-auto`
  plus `not.toContain("flex-wrap")`. This is precisely the KI-16 / KI-19
  responsive class of bug, and "does not wrap" has no non-class expression.
- `"rings the focused column and marks it pressed, so the two agree"` — the
  ring assertion *is* the visual half of the agreement the test is named for.
  Cutting it makes the test's own name false.
- `"does not make its cards draggable, so nothing can move and snap back"` —
  a read-only-board invariant; the enclosing describe records that a control
  added without a `readOnly` clause reaches a reader.
- `ui/preview.test.tsx` `"does not force position:relative when the caller
  positions itself"` — a layout contract: the component must not override the
  caller's positioning.
- `Badge`'s `bg-warning-tint` + `text-warning-ink` — a semantic *pairing* the
  design system defines, not an arbitrary token.

**Total executed: 5 tests removed, 4 merged into 1, one test strengthened, ~15
assertions dropped.** That is the whole of what Phases 5-7 turned out to be
worth against this tree, and it is recorded here so the next reader does not
re-open the plan expecting a large cut.
