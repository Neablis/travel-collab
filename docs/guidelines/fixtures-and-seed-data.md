# Fixtures and seed data

> You added a feature. Where does its sample data go, so the demo trip, the
> preview branch and the tests all keep exercising it?

There are two vocabularies and they are not interchangeable.

| | `@tc/factories` | `@tc/fixtures` |
|---|---|---|
| Answers | "*a* trip that is over budget" | "*the* Japan trip" |
| Built from | Fishery + faker, a `ScenarioSpec` | 72 hand-written rows |
| Content is | anonymous, generated | specific, narratively real |
| Used by | unit tests, integration tests, e2e | `db:seed`, the preview reset, the homepage |
| Costs | a few activities | 72 activities per setup |
| May depend on | anything test-only | `@tc/contracts` + `zod`, and nothing else |

`@tc/fixtures` has the tighter dependency rule because a real bundled route
(`api/dev/reset-demo-data`) imports it. Do not add faker, Fishery, or
`@tc/domain` to its `dependencies` (ADR-030, ADR-020).

## The rule

**A contract field that no fixture exercises is a field with no demo, no
preview, and no screenshot.** The tag chips shipped in M18 against a preview
deployment whose data had zero tags. That is the failure this file exists to
prevent, and `pnpm seed:verify` is what now catches it.

## A hand-built `TripDetail` must not lie about its money

`AGENTS.md` says never a hand-built rollup. Until 2026-09-05 that rule had no
instrument outside the server: `rollupCosts` lives in `@tc/domain`, and the
module map lets only `apps/web/src/server/**` import it — so a component test
had the rule and no way to follow it, and `MacroView.test.tsx` carried two
fixtures whose totals contradicted their own stops (PR #141, one per review
round; both found by a reviewer, neither by a test).

- Need *a* costed trip, shape unimportant → **`costedTripDetailFixture()`**,
  which already derives its own totals.
- Need a *particular* arrangement of days and stops → hand-build it and pass it
  through **`withCostRollups(detail)`** from `@tc/factories`, which recomputes
  every day's `costSubtotal`, the `unscheduledCostSubtotal`, `tripCostTotal`
  and `budgetRemaining` by delegating to the domain's own `rollupCosts`.

Never type a total. A fixture that disagrees with its stops fails in the one
direction nobody checks — it passes.


## Adding a field to an activity, a day, or a trip

1. **Land the contract change first.** Its own reviewed step (AGENTS.md
   invariant 5), before any of this.

2. **Add it to the canonical rows** — `packages/fixtures/src/japan/trip.ts`.
   Give it *varied, plausible* values across the 72 rows, not one value
   repeated: a field where every row agrees is indistinguishable from a field
   nothing reads. If the value is genuinely ours rather than the design
   handoff's, say so in the file's header comment, next to `tags` and
   `lat`/`lng`.

3. **Emit it** in `packages/fixtures/src/japan/commands.ts`.

4. **Measure it** in `packages/fixtures/src/japan/verify.ts` — add a count, a
   histogram, or a "must be empty" findings list, whichever states the thing
   you actually care about.

5. **Declare it** in `packages/fixtures/src/japan/expectations.ts`. If the field
   is an enum, type its histogram as `Record<YourEnum, number>` the way `kinds`
   and `tags` are. That is what makes the *next* value added to that enum fail
   the build until the fixture covers it, rather than passing silently.

6. **Run `pnpm seed:verify`.** It prints the table and names every mismatch.

7. **If the design handoff export also carries the field**, add it to
   `upstreamDrift.test.ts`'s `carried` set so the two are checked against each
   other. If it does not, add it to `NOT_CARRIED_FROM_UPSTREAM` with a reason —
   that list is asserted exhaustive, so a re-sync cannot add a field unnoticed.

## Adding a whole new kind of thing

A new entity (not a field on an existing one) usually wants a factory *and* a
fixture presence:

- **`@tc/factories`** so tests can cheaply say "one of these". Follow the
  existing files: leaf factories return the real contract type, ids come from
  `uuidFrom`, never `crypto.randomUUID` (ADR-020's determinism rule).
- **`@tc/fixtures`** if the demo trip would look wrong or thin without it —
  i.e. if a reviewer opening the preview would notice its absence.

If it belongs to a module other than Trip Planning (Access, Identity,
Community), it does **not** go on the trip rows. `who` is the worked example:
the export carries it, Trip Planning has no field for it, and the fixture folds
it into the activity's notes rather than inventing one (module map, AGENTS.md).

## What `pnpm seed:verify` actually checks

It folds the fixture's commands through the real domain — no database, no
clock — and compares the result to `expectations.ts`:

- counts: 14 days, 68 scheduled, 4 backlog, 72 activities
- `kind` and `tag` histograms, **each value > 0**
- 72/72 coordinates, 66 costs, six cities, one currency
- budget and planned rollups, from `rollupCosts`
- the 12 conflicts `detectConflicts` finds, by kind
- and these findings lists, each of which must be empty: commands the domain
  rejected, empty days, days stored out of chronological order, notes still
  carrying a folded `(status)`, activities with no coordinates, **days that
  would render "N stops have no place yet"**, and coordinates disagreeing with
  the geocode overlay without a recorded reason

### Assert the rendered property, not a proxy for it

The last two of those are the same fact counted two ways, and keeping both is
the point.

`withCoordinates: 72` is a count of *activities*. What a person actually sees on
the Map lens is a per-*day* flag: `mapRailData.ts` builds `locatedStops` from
`day.activityIds`, requiring both `lat` and `lng`, and any day with a shortfall
renders "N stops have no place yet". Those two statements agree right now, and
nothing makes them agree. A trip can hold 72 coordinates and still flag ten days
if the missing ones happen to be the scheduled ones — which is precisely the
state the preview branch was in before ADR-030: 21 unlocated stops across 10 of
14 days, while every local check said the data was fine.

So when you add a check, ask what the reader of the screen would notice, and
assert *that*. A count is a proxy; a proxy is a thing that can be right while
the product is wrong.

Two smaller versions of the same trap, both real and both caught late on
PR #74: `withCoordinates` counted `lat` alone, so a fixture that lost every
`lng` would have reported full coverage while the lens flagged ten days; and
the coordinate check compared against the geocode overlay as though the overlay
were authoritative, when six of its entries point at the wrong venue.

## The geocode overlay is a proposal, not a source

`packages/fixtures/src/japan/coordinates.json` is
`scripts/geocode-japan-seed.mts`'s output. **It is not read at seed time.** The
canonical coordinates are on the rows in `trip.ts`.

Twelve rows deliberately disagree with it, and `coordinateOverrides.ts` records
each with what the geocoder actually matched — six of them the wrong venue
inside the right city, which is the limit KI-39 documents. `verify.ts` fails on
any *unlisted* disagreement, so re-running the geocoder and pasting its output
in cannot silently move a pin.

If you re-run it: expect disagreements, check each one by name against the
overlay's `canonicalName`, and either fix the row or add an override with a
reason. Do not widen the tolerance.

## Changing the trip's content

The Japan trip is a copy of the design handoff's export, and
`upstreamDrift.test.ts` enforces that. So:

- **Editing a stop's title, time, cost or status will fail the drift test** —
  correctly. If the design changed, the export should be re-synced and the
  canonical rows updated to match it, in that order.
- **Editing tags or coordinates is fine** — those are ours.
- **Never edit `.design-sync/handoff/data/japan-trip-seed.json`.** It is an
  upstream drop; a re-sync overwrites it.
