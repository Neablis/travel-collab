# Testing

The single answer to "how do I test this here". Short on purpose: read it in
full before writing a test. `AGENTS.md`'s *Testing model* section carries the
invariants; this is the procedure.

## 1. Which layer

| I changed… | Test it in… | Do NOT also test it in… |
|---|---|---|
| a domain rule (`decide` / `evolve` / `conflicts`) | `packages/domain`, unit + property | a component, an int test, or e2e |
| a schema | `packages/contracts` round-trip | anywhere else |
| an endpoint / projection | `apps/web/src/server/*.int.test.ts` | a component test |
| a component's rendering of given data | one component test, using a scenario factory | e2e |
| a user-visible flow across pages | the milestone e2e script | a component test |
| a pure helper in `src/lib` | a `.test.ts` (node env — no DOM) | anywhere else |
| styling only | **nothing.** The colour wall owns it. | — |

**Prove it at one layer.** Naming the layer is the whole point of the table:
the same rule proven four times costs four maintenance sites and catches one
bug. **Test count is a cost, not a score** — a PR that adds tests without
covering a *new* failure mode made the suite slower and nothing else.

## 2. Should this test exist

Three questions. All must be yes:

1. Can you name a plausible code change that breaks this test?
2. Would that change break **no other test**?
3. Would that change be a real bug, not a deliberate refactor?

If (1) is no, it tests nothing. If (2) is no, it is a duplicate — the other
test is enough. If (3) is no, it is brittleness, and it will cost more than it
saves.

## 3. Red-first: prove the test can fail

**Write the test, then break the code it protects, and watch it go red.** Only
then fix the code back. A test you have never seen fail is a claim, not a
control.

This is not a nicety. On 2026-09-02 three tests were written in one session
that passed while proving nothing, and every one was caught only by doing this
retroactively:

- a resync test that passed with the guard deleted, because the effect it was
  probing is keyed on `[preferences.displayName]` and never re-ran;
- `await waitFor(() => expect(input).toBeTruthy())` on a `const` captured
  *before* the wait — a value that cannot change between retries, so the wait
  waited for nothing. Fixed with `await act(async () => { release(); })`, then
  proven by deleting the guard: `expected 'Sam' to be 'Sam Smith'`;
- an empty-patch check written as `Object.keys(patch).length`, which accepts
  `{ displayName: undefined }` — the emptiest patch there is.

The PR template asks for the source edit and the failure text. Paste the real
message. "I verified it fails" is the claim this rule exists to replace.

**Property tests get this mechanically**: `witness.ts` (duplicated in
`packages/domain`, `packages/pages`, `apps/web/src/test-support`) counts
assertions and fails a property that skipped every generated case. **Measure
the floor, never guess it** — set it near half the observed minimum. A guessed
floor either flaps or is too low to catch anything; both have happened here.

There is no `witness` for an example-based test. Red-first is its equivalent,
and it is manual. When the logic branches too many ways for "delete the fix" to
mean one thing, reach for `pnpm mutate <paths>` instead.

## 4. What the walls already enforce

Do not relearn these by failing `pnpm lint`:

- **Never assert presentation.** `toHaveClass` and `expect(x.className)` are
  errors outside `src/components/ui/**`, where a primitive mapping a variant
  onto a token class genuinely has nothing else to assert.
- **No sleeping in e2e.** `waitForTimeout` needs an `e2e-sleep-allowed:` marker
  carrying a reason, written at the sleep (`scripts/check-sleep-wall.mjs`).
- **`eslint-plugin-testing-library` and `eslint-plugin-playwright`** are on, as
  errors: no `container.querySelector`, no reaching into nodes, `findBy*` over
  `waitFor` + `getBy*`, no `screen.debug()` left behind.
- Pre-existing violations carry a `KI-2026-09-02-b` directive. **Do not copy one
  into a new test** — they are grandfathered, not blessed, and a directive that
  outlives its violation fails lint.

## 5. Finding elements: the locator ladder

| Rank | Query | Use for |
|---|---|---|
| 1 | `getByRole(role, { name })` | anything with an accessible name |
| 2 | `getByLabel` / `getByPlaceholder` | form fields |
| 3 | `getByTestId` | things with no accessible identity (a day column, a rack) |
| 4 | `getByText` | **only** when the text *is* the assertion |
| 5 | CSS / XPath | never |

The distinction is **finding** versus **asserting**. Finding an element →
`getByRole` or `getByTestId`, never `getByText`; every `getByText` used to find
is one copy change from red. Asserting content → `getByText` is right, because
the text is the point. `getByRole` also matches an accessible name split across
child elements, which is what happens the moment a designer wraps half a label
in a `<span>`.

**The testid contract.** Testids name *structure*, never content:
`day-column`, not `day-column-monday`. Dynamic identity goes in a separate
attribute — `data-testid="activity-card" data-activity-id={id}`. A testid is
part of the component's contract: removing one breaks tests, renaming one is a
two-sided edit. **Never add a testid to something that already has a role and a
name.** Current ids: `grep -rhoP 'data-testid="[^"]+"' apps/web/src`.

## 6. Copy these

**Domain property test with a measured floor** —
`packages/domain/test/costs.property.test.ts`:

```ts
it("day subtotals + unscheduled equals the trip total (partition)", () => {
  const w = witness("cost partition");
  fc.assert(fc.property(fc.array(fc.nat({ max: 100_000 }), { maxLength: 12 }), (costs) => {
    const r = rollupCosts(stateOf(costs, costs.map((_, i) => i % 3 !== 0)));
    // Ticks only on a trip that actually carries a cost. `costs: []` makes the
    // partition 0 + 0 === 0 — true of any implementation.
    if (costs.some((c) => c > 0)) w.tick();
    expect(r.dayCostSubtotals.reduce((a, b) => a + b, 0) + r.unscheduledCostSubtotal).toBe(r.tripCostTotal);
    expect(r.tripCostTotal).toBe(costs.reduce((a, b) => a + b, 0));
  }));
  w.atLeast(43); // observed 86-92 runs with a real cost
});
```

**Component test** — find by role or label, assert the behaviour, not the DOM.
Verbatim from `AccountSettingsSheet.test.tsx`:

```tsx
it("saves a name on blur, once", async () => {
  mount();
  const field = await screen.findByLabelText("Your name");
  await userEvent.type(field, "Mitchell");
  await userEvent.tab();

  await waitFor(() => expect(patches).toEqual([{ displayName: "Mitchell" }]));
});
```

The assertion is on **what the component sent**, not on what it rendered — so
it survives a re-skin and fails a real regression. Note `findByLabelText`, not
`waitFor` + `getBy`.

Data comes from `@tc/factories`, never a hand-built `TripDetail`:
`tripDetailFixture(overrides)` is what the suite uses today.
`packages/factories/src/scenarios.ts` also offers named states —
`emptyTrip`, `threeDayTrip`, `overBudgetTrip` — which are a better starting
point when one fits your case (see KI-2026-09-02-d: nothing outside the
factories package imports them yet). If neither fits, **add a scenario there**
rather than hand-building state in the test.

**Integration test** — real Postgres, own its rows, clean up after itself.
`savedDays.stops.int.test.ts` is the model, including why it does not share the
`beforeEach` truncation of the suite next door: a file that truncates cannot
decide what a concurrently-running one sees.

**E2E** — build state through the UI or the API, then assert with web-first
assertions that retry (`toBeVisible`, `toHaveText`), never a sleep.
`m4-money-and-lenses.spec.ts` is the model. Trip names come from
`e2eTripName()` so parallel workers do not collide.

## 7. Running things, and what to believe

Which commands to run for a given change is `AGENTS.md`'s Definition of Done,
and the mechanics are `quality-enforcement.md`. Two rules belong here because
they are about believing a *test result*, and both have been broken twice:

- **An e2e result only counts from `pnpm --filter web test:e2e:ci-like`.** Plain
  `test:e2e` serves `pnpm dev`, which compiles routes on first hit and produces
  timeouts CI does not have (KI-27).
- **Before calling a failure environmental, flaky, or infra, grep
  `docs/known-issues/` for the symptom.** Both times the rule above was broken,
  the entry describing it already existed and went unread. A failure whose
  location *moves between runs* is a timeout; a real defect fails in the same
  place every time.
