# Phase 2 — Typed factories and one seed vocabulary

**The problem this solves.** Test data lives in four unconnected places today:

| Place | What it is | Problem |
|---|---|---|
| `apps/web/src/mocks/fixtures.ts` (143 lines) | `tripDetailFixture(overrides)` | shallow overrides only — you hand-write the whole `activities` record, and keep `costSubtotal`/`tripCostTotal`/`budgetRemaining` internally consistent **by hand** |
| `apps/web/e2e/helpers.ts` → `createMappedTrip` | builds a trip via the real command API | a second, independent vocabulary; e2e-only |
| `apps/web/scripts/db-seed.mjs` (469 lines) | dev/demo seed data | plain untyped ESM; drift-protected only by the server rejecting it at runtime |
| every `*.test.tsx` | hand-built literals | `board.test.tsx` alone spends ~25 lines constructing two activities |

The costs are exactly the ones raised: DB round-trips nobody needed, tests that
are mostly data construction, and no way to express "a realistic over-budget
trip" without writing it out again.

**Deliverable:** `packages/factories` (`@tc/factories`) — one typed vocabulary
consumed by unit tests, integration tests, e2e, and `db:seed`.

> **This adds a fifth workspace package**, which `AGENTS.md`'s module map calls
> a structural change requiring a deliberate decision. Record it as an ADR
> (`ADR-020-test-data-factories.md`) before writing code — that is the repo's
> own rule for irreversible decisions, and `witness.ts`'s header comment shows
> the bar being applied to exactly this question already.

---

## Task 2.1 — Choose the factory mechanism

Use **[Fishery](https://github.com/thoughtbot/fishery)**. It is TypeScript-first,
supports sequences, transient params, associations and `afterBuild` hooks, and
is ~5KB. Two alternatives were considered and rejected:

- **Hand-rolled builder functions** (what `tripDetailFixture` is today). Fine
  until you need nesting and derived consistency, which is exactly where we are.
- **`@faker-js/faker` alone.** Faker generates *values*; it does not compose
  *objects*. Use it **inside** factories for realistic names/places, never as
  the factory mechanism.

**Determinism is mandatory.** Seed faker once per run from an env var with a
recorded default, and print the seed on failure:

```ts
// packages/factories/src/seed.ts
export const FACTORY_SEED = Number(process.env.FACTORY_SEED ?? 20260823);
faker.seed(FACTORY_SEED);
```

A test that uses random data must be reproducible; a recorded seed is what
makes a failure something you can replay rather than something you argue about.

## Task 2.2 — Leaf factories, typed against the real contracts

Every factory's return type is the **contract type**, imported from
`@tc/contracts`. This is the whole point: a contract change breaks the factory
at compile time, which breaks every consumer at compile time — the type-level
version of `db-seed.mjs`'s runtime drift protection, and strictly better.

```ts
// packages/factories/src/trip.ts
import { Factory } from "fishery";
import type { ActivityView, DayView, Location, Money, TripDetail } from "@tc/contracts";

export const moneyFactory = Factory.define<Money>(() => ({
  amountMinor: faker.number.int({ min: 500, max: 50_000 }),
  currency: "USD",
}));

export const locationFactory = Factory.define<Location>(() => { /* real lat/lng pairs */ });

export const activityFactory = Factory.define<ActivityView>(({ sequence }) => ({
  activityId: uuidFrom(sequence),   // deterministic, NOT crypto.randomUUID()
  title: faker.helpers.arrayElement(REAL_ACTIVITY_TITLES),
  timeWindow: { start: "09:00", end: "11:00" },
  location: null,
  notes: null,
  anchors: [],
  cost: null,
}));
```

**Ids must be deterministic** (derive a v4-shaped UUID from the sequence
number). `crypto.randomUUID()` in a factory means a failing test's ids differ
every run, which makes a diff unreadable and a snapshot impossible.

**Values must be realistic.** `faker.lorem.words()` produces titles no user
would type and hides real bugs (a 40-character activity title that overflows a
card). Draw from small curated pools of real trip content — the same Rome /
Kyoto / Niagara vocabulary the existing fixtures and `db-seed.mjs` already use.

## Task 2.3 — The trip factory computes its own rollups

This is the single highest-value piece. `TripDetail` carries four
server-computed fields — `DayView.costSubtotal`, `unscheduledCostSubtotal`,
`tripCostTotal`, `budgetRemaining` — and today every fixture keeps them
consistent by hand. `costedTripDetailFixture` does the arithmetic in comments.

The factory derives them in `afterBuild`, so a fixture **cannot** be internally
inconsistent:

```ts
export const tripDetailFactory = Factory.define<TripDetail, TripTransient>(
  ({ transientParams, afterBuild }) => {
    afterBuild((trip) => recomputeRollups(trip));   // the one place this math lives
    return { /* defaults */ };
  },
);
```

`recomputeRollups` must **mirror**, not re-implement, the projection's rule. If
`packages/domain` exports the computation, call it. If it does not, extract it
there and call it from both — a second copy of a money rule is exactly the
"temporary duplication of contract types" the review guidelines say to reject
on sight, and KI-2 is the standing example of what two copies of money
formatting cost.

## Task 2.4 — Scenario builders (the part tests actually call)

Leaf factories still leave every test assembling a trip. Name the handful of
**states that matter** and expose them as one-liners:

```ts
// packages/factories/src/scenarios.ts
export const scenarios = {
  emptyTrip: () => …,                    // no days — first-run / empty states
  threeDayTrip: () => …,                 // the ordinary case, days + activities
  overBudgetTrip: () => …,               // budget < tripCostTotal → over-budget conflict
  overlappingDay: () => …,               // two activities clashing → time-overlap conflict
  unscheduledHeavy: () => …,             // populated backlog → the rack
  mappedTrip: (dayCount) => …,           // located activities → map rail (replaces createMappedTrip)
  ungeocodedTrip: () => …,               // locations with no lat/lng → KI-15 surfaces
};
```

Every scenario takes overrides and returns a fully-typed, self-consistent
`TripDetail`. **These names become the shared vocabulary** — a test called
`"shows the over-budget banner"` starts with `scenarios.overBudgetTrip()` and
nothing else, and a reviewer knows the state without reading 25 lines of setup.

Derive the list from the Phase 0 inventory's `what it protects` column: every
distinct state that three or more tests build by hand becomes a scenario.

## Task 2.5 — Command-stream builders for integration, e2e, and `db:seed`

Unit tests want a `TripDetail` (a projection). Integration and e2e need the
**event stream** that produces one, because the app is event-sourced and a
directly-inserted row would silently diverge from replay — `db-seed.mjs`'s
header makes this argument correctly and it still stands.

Add the other half of the vocabulary:

```ts
// returns the ordered TripCommand[] that builds the same scenario for real
export function commandsFor(scenario: keyof typeof scenarios): TripCommand[];
```

Then collapse the duplicates onto it:

- **`e2e/helpers.ts`'s `createMappedTrip`** becomes a thin wrapper: POST
  `commandsFor("mappedTrip")` through `page.request`. Delete the hand-written
  command sequence.
- **`scripts/db-seed.mjs`** becomes a TypeScript entry point that POSTs
  `commandsFor(...)` for its demo trips. This removes 469 lines of untyped
  payloads and gives seed data compile-time contract checking — a strict
  improvement on the runtime-only protection its header currently describes.
  Keep the header's reasoning (why it POSTs rather than inserting) verbatim;
  only the payload source changes.
- **Integration tests' `seedBoard()` helpers** (`commands.int.test.ts` and
  friends each have their own) call `commandsFor` instead.

**This also answers the "seeding PRs with important account states" ask.** Once
`commandsFor` exists, a preview deploy can be seeded into any named state with
one command, and the states are the same ones the tests assert against — so a
reviewer clicking through a preview sees exactly what the suite covers.

## Task 2.6 — Cut integration-test DB cost

Seven `*.int.test.ts` files truncate three tables in `beforeEach`. That is
correct but wasteful, and it forces serial execution.

Two options — **measure both against Phase 0's `test:int` number** and keep the
winner rather than assuming:

1. **Transaction rollback per test.** Wrap each test in a transaction that
   always rolls back. Fastest, but only works if the code under test does not
   manage its own transactions — check `eventStore.ts` first, since the
   optimistic-concurrency golden test genuinely needs real concurrent appends
   and must be excluded either way.
2. **Per-test trip ids with no truncation.** Every scenario already mints its
   own `tripId`; tests that assert on *global* row counts (`expect(eventRows).
   toHaveLength(1)`) are the only blockers, and those should be asserting
   scoped to their own stream anyway — that is a latent bug, not just a
   performance problem.

Option 2 is likely both faster and more correct. Do not do both.

---

## Exit checklist

- [ ] `ADR-020-test-data-factories.md` written and merged before the package.
- [ ] `@tc/factories` exists, is typed against `@tc/contracts`, and has its own
      small test proving rollups stay consistent under override.
- [ ] `FACTORY_SEED` is deterministic and printed on failure.
- [ ] `mocks/fixtures.ts`, `createMappedTrip`, and the per-file `seedBoard()`
      helpers are deleted, not merely deprecated.
- [ ] `db:seed` runs from `commandsFor` and produces the same demo trips.
- [ ] `pnpm test:int` measurably faster, with the chosen isolation strategy and
      the measurement recorded in the commit message.
- [ ] Full suite green; test count unchanged (this phase moves data, not
      coverage).
