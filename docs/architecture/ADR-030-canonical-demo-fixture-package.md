# ADR-030 — The Japan demo trip is one canonical fixture, in its own package

**Status:** Accepted — 2026-08-28. Mitchell's call on all four questions below.

**Depends on:** ADR-020 (test data factories as a workspace package), ADR-003
(event sourcing is scoped to planning), ADR-008 (currency is trip-level).

## Context

Three surfaces need the same rich demo trip, and until now two of them carried
their own copy of it:

| Surface | Where its Japan trip came from |
|---|---|
| Local dev (`pnpm --filter web db:reseed`) | a 68-row array written out inside `scripts/db-seed.ts` |
| The preview branch's reset button (`api/dev/reset-demo-data`) | `.design-sync/handoff/data/japan-trip-seed.json` via `src/lib/japanTripImporter.ts` |
| Tests | nothing — `@tc/factories` has only anonymous generated scenarios |

The two copies were **field-for-field identical** on everything the upstream
export owns: all 68 stops plus 4 backlog items agreed on title, place, area,
start, end, status, cost, note and `who`. Nothing made them agree. It was a
drift bug that had not gone off yet.

Where they already differed is the part that mattered:

- **Tags existed only locally.** The export carries none (its `enums` block
  lists only `stopStatus`), so the preview reset produced a trip with **zero**
  `ActivityTag`s. M18 PR 2 ships tag chips and a tag filter row — neither could
  be reviewed on a preview deployment, which is the environment reviews
  actually happen in.
- **Coordinates were 72/72 locally and 51/72 on preview**, and six of those 51
  were the wrong venue. `geocode-japan-seed.mts` had matched Hama-rikyū Gardens
  to `"Tokyo, Chiyoda, Tokyo"` (a city centroid), Bread & Espresso to
  `"Cawaii Bread & Coffee"`, Yoshida-ya to `"Coffee Yoshida"`, Onibus to the
  Setagaya branch, Sushi Yoshitake to `"Sushi Wasabi, Shinjuku"`, and Torishiki
  to a locality. This is exactly the limit KI-39 documents — the geocoder
  rejects candidates outside the right *city*, and "inside Tokyo" is a ~60km
  box. So the preview deployment rendered six stops in the wrong place while
  local dev rendered them correctly.
- **Dates differed structurally**: local used `isoDateInDays(10)` so the trip
  was always upcoming; the export is pinned to `2026-09-20` and goes stale.

Nothing checked any of this. A feature could land, the fixture could stop
covering it, and all three surfaces would quietly go thin with nothing failing.

## Decision 1 — a new workspace package, `@tc/fixtures`, owns the trip

Not `@tc/factories`, which is the obvious place and the wrong one.

`@tc/factories` depends on `@faker-js/faker` and `fishery`. The preview reset
route is **real bundled application code**. Routing it through `@tc/factories`
would put a test-data generator in the app's module graph — precisely the
hazard ADR-020 rejected a `packages/contracts/testing` export over ("a bundler
misconfiguration or an incautious `import` would ship `@faker-js/faker` into
the production bundle").

So `@tc/fixtures` depends on `@tc/contracts` and `zod` and nothing else.
`@tc/domain` is a **devDependency**, used only by the verifier, and the
verifier is deliberately not re-exported from the package index — the public
surface reaches four modules, none of which import the domain.

The dependency direction is `@tc/factories → @tc/fixtures`, never the reverse.

The two packages are also different in kind, which is why one does not subsume
the other. `@tc/factories` generates **anonymous** scenarios: "a" trip that is
over budget, from a `ScenarioSpec` of day counts and cycled locations.
`@tc/fixtures` owns **specific** content: 68 hand-written stops across six real
cities. Squeezing the latter into `commandsFor` would flatten it into exactly
the placeholder data ADR-020 says `commandsFor` is for.

## Decision 2 — the upstream export stays upstream; the package owns a copy

`.design-sync/handoff/` is a re-syncable drop from the design-system project
(`DS-UPSTREAM.md`, `DRIFT.md`). Writing our tags into
`japan-trip-seed.json` would be clobbered on the next sync and would corrupt
its provenance as "what the prototype exported".

Reading *across* into it from a workspace package is no better: it puts a
package's build at the mercy of a directory it does not own.

So the package owns a typed copy (`src/japan/trip.ts`), and
`upstreamDrift.test.ts` parses the real export and asserts the copy still
matches it on every field the export owns. It also asserts the list of
*deliberately not carried* fields is exhaustive, so a re-sync that **adds** a
field fails until someone decides whether it belongs in the fixture.

**That exhaustiveness check has one trap, and the first version fell in it.**
`parseTripSeed` is a `z.object`, and zod strips unknown keys — so walking the
*parsed* seed cannot see a field a re-sync added, which is precisely the case
the check exists for. It walks the **raw** JSON; the content assertions use the
parsed value. Caught by CodeRabbit on PR #74, reproduced by adding a key to the
raw object and watching it vanish from the parsed one, and now pinned by that
same reproduction.

Fields that are ours, not upstream's: `tags`, `lat`/`lng`, and the backlog's
`city`. Tags stay hand-authored per M18's rule that inferring them from title
text is the prose parse that milestone disqualifies.

## Decision 3 — the trip is always dated relative to today

Both real callers pass `startDate: isoDateInDays(10)`. The homepage hero picks
`trips[0]` and shows it as "Next trip"; a fixture pinned to a fixed date
becomes a past trip and the hero degrades, silently, on a date nobody chose.

The export's own `2026-09-20` is not used. `REFERENCE_START_DATE` exists for
the verifier and for tests, which must not depend on the day they run.

## Decision 4 — correctness is asserted, not assumed

`verify.ts` folds the fixture's commands through the **real domain** —
`decideTripCommand`, `evolveTrip`, `rollupCosts`, `detectConflicts` — with no
database and no clock, and reports counts, histograms, coordinate coverage,
conflicts and rollups. `expectations.ts` declares what those should be.

Two mechanisms make it grow with the product rather than rot:

1. **`expectations.kinds` and `expectations.tags` are typed
   `Record<ActivityKind, number>` / `Record<ActivityTag, number>`.** Add a value
   to either enum and the file stops typechecking until the fixture covers it.
2. **Every count in those records must be > 0.** A kind or tag that exists in
   the contract but appears nowhere in the fixture is a finding, not a zero.

It ships as both `pnpm seed:verify` (a readable table) and a vitest suite, so it
rides inside `pnpm check` and cannot be forgotten the way an unwired script
would be.

## Consequences

- The preview branch's reset now produces the same trip local dev gets: all four
  tags, 72/72 coordinates, six of them corrected.
- `scripts/db-seed.ts` loses ~90 lines. Rochester and Portland stay there —
  nothing else consumes them, and they cover shapes Japan does not (an empty
  day, a two-day trip, a non-`JP` country code).
- **Grouping is part of the fixture, not the caller.** One batch is one History
  entry, so `japanTripCommandGroups` splits the seed into setup / one group per
  day / backlog. `db:seed` sends it group by group; the reset route flattens it
  into one batch, trading History readability for all-or-nothing rollback inside
  a 30s Vercel function. Both choices are now written down where the commands
  are built.
- **The geocode overlay is demoted from source to proposal.** It is no longer
  read at seed time. `coordinateOverrides.ts` records all twelve places the
  canonical rows disagree with it, with what it actually matched, and
  `verify.ts` fails on any *unlisted* disagreement — so re-running the geocoder
  cannot silently move a coordinate.
- **`allowImportingTsExtensions` is now on in `tsconfig.base.json`**, and every
  relative import inside `@tc/fixtures` carries a `.ts` extension. `db-seed.ts`
  runs under plain `node` with type-stripping; it got away with extensionless
  workspace imports before only because its `@tc/contracts` import was
  type-only and erased. A value import needs the specifier to resolve for real.
- `@tc/factories` gains `japanTripCommandsFor`, id-minted from its own
  deterministic `uuidFrom` sequence per ADR-020's determinism rule. It is for
  tests that need real richness; 72 activities per setup is the wrong tool for
  "a trip with two days".
