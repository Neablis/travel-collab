# Phase 5 re-inventory — the delta since 2026-08-30

`phase-5-inventory-2026-08-30.md` closed out the prune against the tree as it
stood that evening, and `2026-08-23-test-suite-overhaul.md`'s "Resuming Phases
5–7" section records the verdict: **Phase 5 superseded, Phase 6 absorbed, Phase
7 still open on 7.2 and 7.4.** This document does not reopen any of that. It
covers only what that inventory could not have seen — **test code added or
changed since `e8ba46a` (2026-08-30 21:25 PDT, the commit that carries the
previous inventory)** — plus the residue its §5 named and left undone.

**The headline finding of the previous pass is inherited, not re-derived.** The
`render() >= test count` heuristic produced nine false positives, because it
cannot tell "one render per prop" from "one render per independent behaviour".
It is not used here. `TripBoardScreen.test.tsx` was not re-examined and is not
a candidate.

---

## 1. What the delta actually is

```
git diff --stat e8ba46a HEAD -- '*.test.ts' '*.test.tsx' '*.spec.ts' apps/web/e2e/
→ 61 files changed, 6,929 insertions(+), 1,558 deletions(-)
```

Roughly: M11b's public library (Discover, shared day, leaderboard, public
profile), M15's front door, M17's account preferences, the AI-door
consolidation (`/ai` deleted, `/ask` absorbed its 932-line int test), M18b's
tag focus, and the day-sync work that came out of Mitchell's 2026-09-01 phone
session.

Test declarations repo-wide, `^\s*(it|test)(\.each|\.skip)?\(` across
`apps/**` and `packages/**`:

| | declarations |
|---|---|
| before this pass | **2,541** |
| after | **2,532** |

**−9 declarations, −10 runtime cases.** That is the whole yield, and it is
reported rather than driven to a target, per `phase-5-prune.md`'s standing
decision.

---

## 2. Verdicts, by criterion

The criteria applied, literally, are the eight Principles in the plan index,
restated as the five cut rules: (a) no nameable regression it alone catches;
(b) re-proves a rule at a higher layer than the one that owns it; (c) asserts
presentation, not behaviour; (d) tautology — asserts its own mock; (e)
duplicates a sibling with a trivially different input.

### 2.1 Deleted — 5 tests

| file | test | criterion | why |
|---|---|---|---|
| `apps/web/src/app/api/account/preferences/route.int.test.ts` | `it.each` → `400s a code that is not three letters` / `a unit that is not a unit` / `a name longer than the column promises` (**3 tests**) | **(b)** | The plan's own worked example of (b): *"a Zod schema re-proven in a handler test."* Which values `UpdateUserPreferences` rejects is the schema's claim. What the route owes is that a parse failure becomes a **400** rather than a 500 or a silent 200, and the two tests either side of the deletion (`400s an empty patch`, `400s a body that is not an object at all`) say exactly that. The two values not yet asserted at the schema layer — `homeAirport: "SFOO"` and an 81-character `displayName` — were **moved down** into `packages/contracts/test/identity.test.ts`'s existing `still validates the fields it is given`, so nothing is lost; it is asserted once, where it lives. |
| `packages/contracts/test/identity.test.ts` | `accepts a patch whose only value is null` | **(e)** | `distinguishes clearing a field from omitting it`, three tests above it, already does `UpdateUserPreferences.parse({ displayName: null })` and asserts what comes out. A `safeParse(...).success === true` on the same input is the strictly weaker half of an assertion already present in the same file. Its comment (the contrast with the `undefined`-keys refusal above it) was kept as prose. |
| `apps/web/src/components/playbooks/SharedDayScreen.test.tsx` | `tags a day over twelve hours as Long` | **(b)** | `lib/savedDayFacts.test.ts` asserts `dayLength({ start: "08:20", end: "20:30" }) === "long"` — the same window, from the layer that owns the rule, from both sides of both edges. That the **rail prints** whatever `dayLength` answers is already proved by `states the facts in the rail`, which asserts the Medium band off a real derived window. A second band was the same wiring with a second fixture. |

### 2.2 Merged — 6 pairs, 12 declarations → 6

| file | merged | criterion | note |
|---|---|---|---|
| `playbooks/LeaderboardScreen.test.tsx` | `stops pretending to load when the first read failed` + `offers a Retry when the board cannot be reached` | **(e)** | Byte-identical setup (the same failing mock, the same render). One asserted "exactly one Retry", the other "a Retry inside `library-sync-failure`". Both assertions survive in the merged test; neither test's claim is weakened. |
| `playbooks/ProfileScreen.test.tsx` | the identical pair, on the profile route | **(e)** | Same shape, same treatment. |
| `lib/pendingDemoClone.test.ts` | `expires rather than firing on an unrelated sign-in days later` + `clears an expired marker instead of leaving it to fire later` | **(e)** | The first test's *only* assertion is line 1 of the second. Strict containment. |
| `lib/savedDayFacts.test.ts` | `is Short under four hours` + `puts exactly four hours in Medium, not Short` | **(e)** | Both contained the literal line `expect(dayLength({ start: "09:00", end: "12:59" })).toBe("short")`. The file's own header comment says the edges are asserted from both sides — which is a claim about one edge, and now reads as one test. |
| `trip/SettingsSheet.test.tsx` | `states the day, stop and city counts…` + `shows them to a viewer too…` | **(e)** | Identical three assertions, differing only in `myRole`. Now one `it.each(["owner", "viewer"])` table, which also states the role-independence as the claim rather than leaving it implicit in two copies. (Same idiom the 2026-08-30 pass used for `TripViewTabs`; note it still produces two runtime cases, so this merge costs a declaration, not a case.) |
| `playbooks/DiscoverScreen.test.tsx` | `is where the leaderboard is entered from` folded into `shows the leaderboard link only when something is published` | **(e)** | A one-assertion test (the link's `href`) beside a test that already resolved the same link by role. Where the link goes and whether it is there are one claim. |

### 2.3 Assertions dropped or rewritten — 3

Not test deletions; recorded for completeness because §8 of the previous
inventory did the same.

- `playbooks/LeaderboardScreen.test.tsx`, in `ranks on adds, not on days
  shared`: `expect(rows[2].getAttribute("data-user-id")).toBe("dev-carol")`
  removed. The `toEqual(["dev-bob", "dev-alice", "dev-carol"])` immediately
  above makes it unfailable — a **(d)**-shaped restatement of the line before
  it. Its explanatory comment (why the fixture makes ordering a real claim)
  was kept and attached to the surviving assertion.
- `ui/composites.test.tsx`: `expect(getByLabelText("Trip name").tagName).toBe("INPUT")`
  → `.id).toBe("trip-name")`. Criterion **(a)**, and the §5 residue item. The
  test's name is *"FormField wires label→control"*; the `<input>` is supplied
  **by the test itself**, so the tag assertion proved `Input` renders an input
  — which `ui/primitives.test.tsx` proves against the primitive. What was
  unasserted is the wiring: which control the label points at.
- `board/ActivityCard.test.tsx`, in `renders chips as text, not controls`:
  the `for (const chip of chips) expect(chip.tagName).toBe("SPAN")` loop
  removed, replaced with a length guard. Criterion **(c)/(a)**: "not a
  control" is a role claim, and `queryByRole("button") === null` on the next
  line already carries it. The tag assertion would fail on a perfectly good
  `<div>` and pass on a `<span role="button">` — it tests the wrong thing in
  both directions.

### 2.4 Assertions moved down a layer — 2

`packages/contracts/test/identity.test.ts`, `still validates the fields it is
given`, gained `{ homeAirport: "SFOO" }` and `{ displayName: "a".repeat(81) }`.
This is the other half of §2.1's first row: the (b) treatment is *move the
claim to its own layer*, not *delete the claim*.

---

## 3. Examined and kept — and why, so nobody re-litigates them

Roughly 90 test declarations across the delta were read as candidates. The
ones that looked cuttable and are not:

### 3.1 The near-miss (b) case: `DayChips` keyboard vs `stepDay`

`trip/DayChips.test.tsx`'s new keyboard block has three tests whose names all
but match `trip/centralDay.test.ts`'s `stepDay` tests — including a verbatim
shared name, `clamps at both ends rather than wrapping`. That is the strongest
(b) signal in the delta and it is a **false positive**.

Criterion (a) settles it: name a code change that breaks the component tests
and no others. `onSelect(focusedDay + dir)` written inline in `DayChips`
instead of routing through `stepDay`. That leaves every `stepDay` test green
and leaves `walks right and left through the days` green, and breaks exactly
the clamping and no-selection tests. They guard the *wiring to the helper*,
which is a different regression from the helper's own rule. **Kept.**

This is the delta's own version of the nine false positives, and it is written
down for the same reason: the name-similarity signal is seductive and wrong.

### 3.2 The `className` assertions added since 2026-08-30

Only eight new ones exist repo-wide in the delta (measured on added lines):

| file | assertion | verdict |
|---|---|---|
| `ui/overlays.test.tsx` | `overflow-y-auto` + `min-h-0` on a capped dialog body | **Kept.** The behaviour is *scrolling*, and jsdom has no layout to measure it with; `min-h-0` beside `flex-1` is the mechanism, not decoration. The test comment argues this explicitly and names where the behaviour is proved for real. |
| `ui/overlays.test.tsx` | `-mx-1` + `px-1` focus-ring clearance | **Kept, and it is the weakest survivor in this document.** It is closer to pure presentation than anything else on this list. It stays under the same precedent that kept `ui/preview.test.tsx`'s *"does not force position:relative"*: it guards a specific regression reported twice (PR #55) that has no non-class expression in jsdom. If a later pass wants one scalp from this file, this is the one. |
| `trip/TripHeader.test.tsx` ×3 | `hidden md:block` / `hidden` / `md:flex` on the phone-shed test | **Kept.** The class *is* the breakpoint, and the breakpoint number is what a browser test cannot tell you — `e2e/responsive.spec.ts` asserts what actually renders at 411px, and these pin *which* breakpoint produces it. Noted, though: `.toBe("hidden md:block")` is full-string equality, so any added utility class breaks it. That is a Phase-6 de-brittle (`toMatch`), not a prune, and is out of scope here. |
| `playbooks/LeaderboardScreen.test.tsx` | `bg-brand-tint` on your own row | **Kept**, under the 2026-08-30 precedent for *"rings the focused column and marks it pressed, so the two agree"*: the test is named `tints and badges your own row`, and the tint is one of the three things it names. |

### 3.3 Everything else read and kept

- **`account/PreferencesProvider.test.tsx`, `account/AccountSettingsSheet.test.tsx`** —
  two tests and eleven respectively, every one an independent failure of a
  controlled form or a race. The Sheet's file carries a long comment recording
  a scenario review asked for that turned out **not to be reachable**, verified
  by removing the guard and watching the candidate test still pass. That is the
  opposite of the species this pass hunts.
- **`playbooks/useLibraryRead.test.tsx`** — four tests, all on the hook rather
  than through a screen, precisely because the property is the hook's. Nothing
  to move down; it is already at its own layer.
- **`playbooks/DiscoverScreen.test.tsx`** (23 tests) — the option-list
  assertions (`offers exactly two sorts`, `four budget bands over
  $200/$500/$1,000`, `filters by season`) read as copy assertions and are not:
  a filter's vocabulary is its behaviour, and the band labels are the only
  place `BUDGET_BAND_EDGES` is pinned against what the control shows.
- **`playbooks/SharedDayScreen.test.tsx`** (the remaining 19) — every one a
  distinct server answer or a distinct author/viewer state.
- **`lib/units.test.ts`, `lib/savedDayFacts.test.ts`** — `fast-check`
  properties with measured witness floors, untouched per `AGENTS.md`'s testing
  model. No floor was lowered and no property was deleted anywhere in this
  pass.
- **`lib/displayName.test.ts`** — `keeps two different people apart` and
  `still tells apart two ids that share their final four characters` look like
  an (e) pair and are not: the second uses ids differing at the
  *fifth-from-last* character, which is the suffix **width** the first cannot
  see past. Its comment says so, and the comment is correct.
- **`app/(app)/page.test.tsx`** (+7 tests, the demo-clone redemption) — the
  two in-flight-race tests hold different fetches open (the duplicate, and the
  trip list) to reach two genuinely different windows. Not merge-able.
- **`trip/context/FocusProvider.test.tsx`** (+13) — `does not claim a lock when
  there was nothing to scroll` and `drops the lock at once when the day was
  already in view` assert the *same* final state, which reads as (e). They
  exercise different branches of `jumpTo` (no scrollable element vs. offsets
  unchanged). Merging would drop a branch. **Kept.**
- **e2e** (+9 tests across `m10-growth`, `responsive`, `m11b-playbooks`,
  `m17-account-preferences`) — `the header's selected day follows…` and `every
  day container follows the selection…` overlap on "a scroll moves the
  selection", but differ in axis (vertical timeline vs horizontal chips),
  viewport (desktop vs 411px) and clause (1 vs 1+2+3). Merging them makes one
  three-minute test out of two ninety-second ones and couples two failures
  into one signal. **Kept.** `keeps all three in the header at desktop width`
  is a three-assertion counterpart to the phone test and is what makes the
  phone assertions statements about the *breakpoint* rather than about a
  control that stopped rendering everywhere — a mirror, not a duplicate.

### 3.4 The §5 residue not actioned

The previous inventory's §5 counted **7** category-(a) framework assertions.
Two are cut above (`ui/composites.test.tsx`, `board/ActivityCard.test.tsx`).
The rest were read and kept, with reasons:

- `ui/primitives.test.tsx` — `Input`/`NativeSelect` `.tagName` are `INPUT`
  and `SELECT`. The test is named *"Input and NativeSelect are native
  elements"*, and nativeness is a real design-system contract with real
  accessibility consequences. `getByLabelText` resolving proves labelling, not
  nativeness. **(a) is satisfied: replace either primitive with a custom
  widget and only this fails.**
- `ui/page-container.test.tsx` — `renders as <main> when asked` is the only
  test of the `as` prop, and a landmark element is a real regression.
- `board/ActivityCard.test.tsx` — the *other* `.tagName` (`BUTTON`, in
  `renders chips as toggle buttons once a toggle is given`) is kept: keyboard
  operability depends on the element being a real button, and `aria-pressed`
  alone would pass on a `<span>`.

The ~45 `className` assertions §8 of the previous inventory deliberately kept
were not revisited. They are outside this delta and that decision stands.

---

## 4. What this pass did not do

- **No coverage run and no mutation spot-check.** `phase-5-prune.md` Task 5.3
  names both as preconditions for deleting anything. Neither was run. The five
  deletions were argued individually — each names the test elsewhere that
  carries the same claim, and for the (b) cases the claim was *moved*, not
  dropped — but that is an argument, not a measurement, and it is stated as
  such.
- **`TripBoardScreen.test.tsx` was not re-read.** Out of the delta, and the
  previous inventory's verdict on it stands.
- **No de-brittling.** `TripHeader.test.tsx`'s full-string `className`
  equality (§3.2) is the one thing found that wants it. Phase 6 is closed as
  absorbed; if this is ever worth doing it is a one-line change with its own
  reasoning, not a reopened phase.

---

## 5. Verdict

**The delta is lean.** 6,929 lines of test code arrived in three days carrying
M11b, M15, M17, M18b and the AI-door consolidation, and it yielded five
deletions, six merges and five assertion-level edits — nine fewer declarations
against a suite of 2,541.

That is consistent with, and slightly smaller than, the 2026-08-30 pass (5
removed, 4 merged into 1). Two things explain it, and both are good news:

1. The tests written since carry their reasoning inline. Nearly every
   candidate examined here had a comment saying *why* it exists and what
   regression it caught, which is exactly what makes the cut criteria cheap to
   apply — and what made most of them survive.
2. The species the prune was designed to sweep — per-prop renders, `className`
   walls, domain rules re-proven through the UI — is not being written any
   more. The one genuine (b) hit in the delta (a schema re-proven in a handler)
   is a single `it.each` block.

**The recommendation is unchanged from 2026-08-30: there is no prune backlog.**
What remains open from the overhaul is Phase 7's undone half —
`docs/guidelines/testing.md` (7.2) and a `write-a-test` skill (7.4) — both of
which would do more for the next 6,000 lines than a third inventory will.

---

## 6. A defect found while verifying, which is not this pass's

Reported here because it was found here, and it is not flakiness.

**`window.localStorage` is `undefined` in the jsdom unit lane.** Two files are
red on unmodified `HEAD` (`56a5cf5`):

- `apps/web/src/lib/pendingDemoClone.test.ts` — 7 of 7 tests
- `apps/web/src/app/(app)/page.test.tsx` — 6 of 27 tests

Root cause, traced rather than guessed: Vitest 4's jsdom environment copies a
fixed `KEYS` allowlist from the jsdom window onto the test global. That list
contains the `Storage` **constructor** and `StorageEvent`, but not the
`localStorage` / `sessionStorage` **instances**. jsdom 29.1.1 itself provides
them — constructing a `JSDOM` with `url: "http://localhost:3001"` directly
yields `typeof window.localStorage === "object"` — so the seam is Vitest's
global population, not jsdom and not the `url`.

Evidence it is pre-existing and not this pass's: with all changes stashed,
`pendingDemoClone.test.ts` fails 7/7 with the same `TypeError: Cannot read
properties of undefined (reading 'clear')`. `vitest.unit.config.ts`'s comment
records that this file was deliberately added to `JSDOM_TS_FILES` *because*
`localStorage` is a browser API, so the intent is clear and the mechanism
regressed under it.

The fix is a `globalThis.localStorage` shim in `vitest.setup.ts` or an
`environmentOptions` change — **non-test source, which this pass was scoped
out of**, so it was not attempted. Nothing in `docs/known-issues/` matches
(`grep -r localStorage docs/known-issues/` → no hits), so this wants a KI entry
or a fix, not a re-run.
