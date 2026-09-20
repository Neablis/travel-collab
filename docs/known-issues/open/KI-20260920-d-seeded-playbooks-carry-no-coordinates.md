### KI-2026-09-20-d — the seeded Playbook library carries almost no coordinates, so §16's map draws on one day out of ten

- **Severity:** content, and it hid a whole feature. Nothing is wrong, nothing
  errors, and the surface a milestone had just built was invisible on every
  seeded database including the preview.
- **Area:** `packages/fixtures/src/japan/savedDays.ts`,
  `packages/fixtures/src/library/starterDays.ts`, and by consequence
  `apps/web/src/components/playbooks/SharedDayMap.tsx`.

- **Symptom / What happens:** SPEC §16 is *"a shared day is a map plus a
  list"*. M26 built `SharedDayMap` for it. Walked on the PR preview,
  2026-09-20, at 1440x1100 against three different shared days — one starter
  day, one Japan day and the three-day M23 Playbook — **every one rendered
  `canvas=0` and `shared-day-pin=0`**. Not an error, not an empty canvas: the
  component's degrade-to-list-only path, doing exactly what §16 asks.

  The cause was the data. Both seed fixtures build a stop's place with a
  `stop()` helper that wrote `location: { name, city }` and dropped everything
  else, so **not one saved-day stop in the repository carried a `lat`**.
  `worthDrawing` needs two located stops on the scoped day; the library offered
  zero anywhere.

  This is the same report Mitchell made from the preview on 2026-09-19 — *"a
  playbook activity doesn't even have a map"* — which M26 answered by building
  the component. The component was only ever half the answer.

- **Fixed so far (2026-09-20):** three coordinates, and the count is the
  point. `coordinates.json` — this repo's own reviewed geocode of the Japan
  trip — already held `d8-s1-fushimi-inari-at-dawn`,
  `d8-s3-kiyomizu-dera-and-sannenzaka` and `d8-s5-nishiki-market`, each
  checked once against its `canonicalName`. Those three were lifted onto the
  two saved days whose stops are the same places, which buys exactly what the
  gate box needs and nothing more:

  | day | located stops | what it shows |
  |---|---|---|
  | Kyoto temples on foot | 2 of 4 | the map DRAWS, with a gapped leg over the two unlocated stops |
  | Kyoto, then an evening in Osaka | 1 of 3 | §16's degrade-to-list-only, beside it on the same Discover page |
  | the other eight | 0 | still list-only |

  `packages/fixtures/src/savedDayCoordinates.test.ts` holds all three facts and
  was seen red for each of them.

- **Still open:** the other ~44 stops across both fixtures. **They were not
  hand-authored on purpose.** KI-39 is the entry that cost this seed a pin in
  the wrong country, `geocode-content.py`'s `--apply` skips any stop that
  already has a `lat` — so a wrong coordinate written here is permanent until
  somebody runs `--retract` — and this session had no geocoder: the container's
  egress gateway answers 403 to `CONNECT nominatim.openstreetmap.org:443`, so
  every lookup would have been from memory. A coordinate from memory is an
  impression wearing a figure's clothes, which is the thing this milestone's
  Wave 2 retro is about.

- **Fix sketch (not done):** run the geocoder over the two fixtures the way
  `content/**` bundles are done — `docs/guidelines/content-bundles.md`'s
  Coordinates section is the whole recipe, including why the `--review` step is
  not optional and why city-level answers are withheld. The fixtures are
  TypeScript rather than JSON, so either teach the script to emit a coordinate
  table the fixtures import (the `coordinates.json` pattern, which is how the
  Japan trip already does it) or move the library to `content/`. The first is
  smaller and keeps the two sets of demo data distinguishable, which
  `starterDays.ts`'s own header argues for at length.

- **Related, and NOT the same thing:** the PR preview's database has never had
  `pnpm --filter web content:import` run against it. `db:reseed` is
  `db:reset && db:seed && content:import`, and the preview's Discover shows ten
  days — the two fixtures and nothing else — where the nineteen bundles under
  `content/` are all geocoded already. So a preview walked after an import
  would show maps on bundle days whatever happens to this entry. That is an
  environment task with a database credential attached, not a code change.

- **How it was found:** walking the preview for M26's five `[walk]` gate boxes,
  2026-09-20. No test could have found it — every unit test of `SharedDayMap`
  supplies its own located fixture, which is exactly why the new assertion is
  about the CONTENT and lives in `packages/fixtures`.

- **First noted:** 2026-09-20.
