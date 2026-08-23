# ADR-020: Test data factories as a fifth workspace package (`@tc/factories`)

**Status:** Accepted — 2026-08-23
**Deciders:** Mitchell (product/eng), Claude (test-suite-overhaul agent)
Plan: `docs/plans/test-overhaul/phase-2-factories.md`

## Context

Test data lives in four unconnected places: `apps/web/src/mocks/fixtures.ts`
(hand-built `TripDetail` literals with rollups kept consistent by hand),
`apps/web/e2e/helpers.ts`'s `createMappedTrip` (a second, independent
vocabulary, e2e-only), `apps/web/scripts/db-seed.mjs` (469 lines of untyped
demo-data payloads), and every component test's own hand-built literals
(`board.test.tsx` alone spends ~25 lines constructing two activities).

The costs: DB round-trips nobody needed, tests that are mostly data
construction, no way to express "a realistic over-budget trip" without
writing it out again, and — the sharpest edge — `TripDetail`'s four
server-computed rollup fields (`DayView.costSubtotal`, `unscheduledCostSubtotal`,
`tripCostTotal`, `budgetRemaining`) kept consistent *by hand* in every
fixture that needs them to be. A fixture that drifts from the real rollup
math is a bug the tests using it cannot see — a duplicate of exactly the
kind of duplication `docs/known-issues.md`'s KI-2 records the cost of for
money formatting specifically.

## Decision

**Test data gets one typed vocabulary: `packages/factories` (`@tc/factories`),
built on [Fishery](https://github.com/thoughtbot/fishery) and
[`@faker-js/faker`], consumed by unit tests, integration tests, e2e, and
`db:seed`.**

This is a new workspace package — a structural change `AGENTS.md`'s module
map calls out as requiring a deliberate decision, hence this ADR rather than
folding the choice into a phase file. Two alternatives were weighed and
rejected:

1. **`apps/web/src/test-support/`.** Unreachable from `packages/domain`
   tests and from `scripts/db-seed.mjs` (a Node script outside the `apps/web`
   Vite/Next module graph), so it would preserve exactly the duplication
   this decision exists to remove — `db-seed.mjs` would keep its own
   469-line vocabulary forever.
2. **A `packages/contracts/testing` export.** Ships test-only code inside a
   package production code imports; a bundler misconfiguration or an
   incautious `import` would ship `@faker-js/faker` into the production
   bundle. `@tc/contracts` is deliberately zero-dependency beyond `zod`.

**Why this bar is different from `witness.ts`'s** (`AGENTS.md`'s Testing
model: "measure the floor, don't guess it" was kept as a ~20-line duplicated
helper per package, not centralized). `witness.ts` has one shape and one
consumer pattern per package; centralizing it would add a cross-package
dependency to save a few lines. Factories have **four real consumers**
(unit, integration, e2e, `db:seed`), are typed against a shared contract
(`@tc/contracts`) that already crosses package boundaries, and this decision
deletes roughly 600 lines of duplicated/hand-maintained vocabulary rather
than adding 20. The two problems are not the same shape.

**Fishery over hand-rolled builders or bare Faker.** Hand-rolled builder
functions are what `tripDetailFixture` already is — fine until nesting and
derived consistency are needed, which is exactly where this repo is now.
Faker generates *values*, not *objects*; it is used **inside** factories for
realistic names and places, never as the composition mechanism itself.

**Determinism is mandatory.** `FACTORY_SEED` (default `20260823`, overridable
via env var) seeds faker once per process and is printed on any factory-data
assertion failure — a test using generated data must be reproducible from a
recorded seed, not argued about after the fact. Generated ids are derived
deterministically from Fishery's sequence counter, never
`crypto.randomUUID()`, for the same reason.

**Leaf factories return the real contract type** (`import type { TripDetail }
from "@tc/contracts"`), so a contract change breaks the factory at compile
time — the type-level version of `db-seed.mjs`'s runtime-only drift
protection, and strictly better.

**The trip factory computes its own rollups by calling `@tc/domain`'s
`rollupCosts`, never re-implementing the arithmetic.** `rollupCosts` already
operates on the exact `{ days, activities, backlog }` shape `TripDetail`
carries (structurally compatible with `TripState`, its original type), so no
extraction was needed — Task 2.3's fallback path ("extract the computation
into `packages/domain` if it isn't already exported") didn't apply here, but
is recorded for the next factory whose rollup rule isn't already public.

**Both vocabularies exist: projections for unit tests, commands for
integration/e2e/seed data.** Unit tests want a `TripDetail` (a read model).
Integration tests, e2e, and `db:seed` need the **event stream** that
produces one, because the app is event-sourced and a directly-inserted row
would silently diverge from replay (the argument `db-seed.mjs`'s own header
already makes, and it still stands). `commandsFor(scenario)` returns the
ordered `TripCommand[]` for a named scenario; `scenarios[name]()` returns
the equivalent already-projected `TripDetail`. Both read from the same
curated data (city names, activity titles, cost amounts) so a unit test and
an e2e spec asserting "the over-budget trip" are asserting on the same trip.

## Consequences

- `apps/web/src/mocks/fixtures.ts` is deleted; its 24 callers import from
  `@tc/factories` instead (import + setup-block changes only — Phase 2 does
  not rewrite test bodies).
- `apps/web/e2e/helpers.ts`'s `createMappedTrip` becomes a thin wrapper
  around `commandsFor("mappedTrip")` posted through `page.request`.
- `apps/web/scripts/db-seed.ts` (renamed from `.mjs`) is now typed against
  `@tc/contracts`'s `TripCommand` via Node's native TypeScript stripping —
  zero new dependencies, `tsc --noEmit` now catches a renamed/removed
  command field before the script ever runs. It does **not** route its
  content through `commandsFor`: `commandsFor`'s generic named scenarios
  exist for tests and e2e, where "a" over-budget trip is the point, but
  this script's three demo trips are specific, narratively real content
  (14-day Japan itinerary, 68 stops) that flattening into a generic
  scenario would destroy. Both draw on the same `TripCommand` vocabulary;
  only the content differs. Its header's reasoning for POSTing rather than
  inserting is preserved and updated to describe the new drift-protection
  story.
- New dev dependencies: `fishery`, `@faker-js/faker` (both dev-only, per
  `docs/guidelines/stack-and-constraints.md` constraint 3 — justified above:
  Fishery is the composition mechanism this ADR adopts; Faker supplies
  realistic values inside factories, never used to generate whole objects).
- A future factory whose source rollup rule is *not* already exported from
  `packages/domain` must extract it there rather than duplicate it — this is
  the standing rule this ADR establishes, not a one-time exception.
