# Phase 6 — Rewrite the survivors so they stop breaking on copy changes

> **ABSORBED 2026-08-31. Do not execute as a phase.**
>
> Task 6.4 landed as `scripts/check-sleep-wall.mjs`. Task 6.5 landed as
> `AGENTS.md`'s "Testing model" property-test rule plus the per-package
> `witness.ts`; its last gap — three `fast-check` files carrying no witness
> floor — was closed 2026-08-30 with measured, non-vacuity-proven floors.
> Tasks 6.1-6.3 were substantially met by the tests M10/M11 actually shipped.
> See `phase-5-inventory-2026-08-30.md` §5 for the residue.

**Scope: only tests that survived Phase 5.** Do not de-brittle something you
are about to delete — that is why 5 comes first.

**The complaint this answers:** tests that break on every small text change.
The measured shape of it — 65 `getByText` calls in `e2e/`, and 13 in
`TimelineLens.test.tsx` alone. Every one is a test coupled to prose that a
designer will change without touching behavior.

---

## Task 6.1 — Move up the locator ladder

[Playwright's and Testing Library's ranking is the same
one](https://qaskills.sh/blog/playwright-best-practices-locators-2026), and it
is ordered by how much refactoring each survives:

| Rank | Query | Use for |
|---|---|---|
| 1 | `getByRole(role, { name })` | anything with an accessible name — buttons, links, headings, inputs |
| 2 | `getByLabel` / `getByPlaceholder` | form fields |
| 3 | `getByTestId` | things with no accessible identity (a day column, a card container, a rack) |
| 4 | `getByText` | **only** when the text *is* the assertion |
| 5 | CSS / XPath | never here (currently 4 uses; drive to 0) |

`getByRole` with `name` is more robust than `getByText` in a way that matters
here: [it matches the accessible name even when the text is split across child
elements](https://testing-library.com/docs/queries/byrole/), which is exactly
what happens when a designer wraps half a label in a `<span>` for styling. It
also doubles as accessibility coverage.

**The rule to apply mechanically:**

- Finding an element → `getByRole` or `getByTestId`. **Never `getByText`.**
- Asserting *content* → `getByText` is correct, because the text is the point.
  `expect(getByRole("status")).toHaveTextContent("All changes saved")` is a
  content assertion and is fine.

The distinction is *finding* vs *asserting*. Most of the 65 e2e `getByText`
calls are finding, and each is a copy change away from red.

## Task 6.2 — A stable testid contract

Some things have no accessible identity and should not be given a fake one just
to be queryable. The repo already uses testids well in places
(`day-column`, `unscheduled-rack`). Make it a documented contract rather than
an ad-hoc habit:

- Testids name **structure**, not content: `day-column`, `activity-card`,
  `unscheduled-rack`, `budget-meter`. Never `day-column-monday`.
- Dynamic identity goes in a **separate attribute**, not baked into the id:
  `data-testid="activity-card" data-activity-id={id}`. This is what lets a test
  say "the card for this activity" without coupling to its title.
- A testid is part of the component's contract. Removing one is a breaking
  change to the tests; renaming one is a two-sided edit.
- **Never add a testid to something that has a role and a name.** That is the
  regression this contract is meant to prevent.

Write this table into `docs/guidelines/testing.md` in Phase 7 and list the
current testids so nobody invents a parallel scheme.

**There is already drift to clean up while you are here:** the codebase uses
kebab-case throughout (`day-column`, `map-lens`, `budget-meter-fill`) except
`data-testid="dayCount"`, and carries several one-word ids that are too generic
to be safe in a `within()`-less query (`editor`, `error`, `lens`). Normalize to
kebab-case, and prefix the generic ones with their component
(`activity-editor`, `page-editor-error`).

## Task 6.3 — Assert behavior, never presentation

Every `expect(el.className).toContain(...)` should already be gone from Phase
5.1(b). This task catches the subtler versions:

| Instead of | Assert |
|---|---|
| `className` contains `bg-danger` | `toHaveAttribute("aria-invalid", "true")` or the error message is present |
| `className` contains `hidden` | `not.toBeVisible()` |
| a specific DOM structure / tag name | the accessible role |
| exact formatted money string in a component test | that `formatMoney` was given the right minor units — the formatting itself is tested once, in `formatMoney.test.ts` |
| element ordering by index | the semantic relationship (`within(day2).getByRole(...)`) |

The last row is worth stating plainly: **format-once, assert-once.** KI-2 was
two copies of money formatting drifting apart. The fix was one formatter. Tests
should follow the same rule — one test proves the format, every other test
asserts the value, not the string.

## Task 6.4 — Remove every remaining wait

Phase 4 handled the unit-side spurious `waitFor`s and Phase 3 handled e2e's
`waitForTimeout`s. Sweep for what is left:

- `await new Promise(r => setTimeout(r, n))` anywhere in a test.
- `waitFor` wrapping a *synchronous* assertion.
- `waitFor` with multiple assertions inside — split it; a `waitFor` that
  retries three assertions retries the first two pointlessly and reports the
  wrong failure.
- Bare `act()` calls that a `findBy*` would replace.

Add lint rules for these in Phase 7 so the sweep is once, not forever.

## Task 6.5 — Convert genuine "for all inputs" claims to property tests

`AGENTS.md` already says a claim of the form "for ALL inputs" gets a property
test wherever it lives, and `fast-check` is available in all three packages.
This phase is the moment to apply it, because it is the highest
tests-deleted-per-test-added ratio available: a handful of example-based tests
enumerating cases collapse into one property with a `witness` floor.

Candidates, from the Phase 0 inventory:

- `dayAccent.ts` — "every distinct city gets a distinct accent" is a property,
  and it is **KI-18's actual contract**. Phase 8 of the M10 plan fixes the
  collision; a property test is what keeps it fixed. Coordinate: if M10 Phase 8
  has landed, write the property against the fixed function; if not, leave a
  note in the KI-18 entry that this is the test it should ship with.
- `unscheduledRack.ts`'s `fitIntoDay` — "the result is always a valid, non-
  overlapping window inside the day".
- `formatMoney` — "round-trips minor units for every currency and sign".

**Every new property test carries a `witness` with a measured floor.** Not a
guessed one — `witness.ts`'s own header records that guessed floors flapped
3-in-15, and a flapping vacuity check is worse than none.

---

## Exit checklist

- [ ] Zero `getByText` used for *finding* (asserting is fine and expected).
- [ ] Zero raw CSS/XPath locators in `e2e/`.
- [ ] Zero `className` assertions anywhere.
- [ ] Zero `setTimeout`/`waitForTimeout` in any test.
- [ ] Testid contract documented, and existing testids conform to it.
- [ ] At least the three property tests above, each with a measured `witness`
      floor.
- [ ] **The brittleness drill:** change a piece of user-facing copy that is
      purely presentational (a heading, a button label's wording) and confirm
      the suite stays green except where the copy *is* the assertion. If more
      than a couple of tests break, this phase is not done.
- [ ] Full suite green: unit, int, `test:e2e:ci-like` twice.
