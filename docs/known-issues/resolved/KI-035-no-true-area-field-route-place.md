### KI-35 — No true "area" field; route and place lines are a city-or-first-segment approximation — RESOLVED
- **Resolved (2026-08-28)** by adding the field the entry's own fix path named.
  `Location.area` (`packages/contracts/src/activity.ts`) is a real optional
  field — the sub-settlement locality, one level finer than `city` — populated
  by the geocoder from the same structured address breakdown and preferred
  ahead of the venue-name fallback in both helpers this entry names.
- **What was actually wrong, reproduced first.** Against the real Japan seed:
  `Location.parse({ …, area: "Nishi-Azabu" })` returned an object with `area`
  `undefined` (the contract had no such field, so zod stripped it); the
  importer's `AddActivity` for "Dinner at Gonpachi" carried
  `{name, city: "Tokyo", lat, lng}` and no area; and `shortPlace()` on the
  backlog idea "Kiyomizu-dera at golden hour" — which has an area
  ("Higashiyama") and no city — returned **`"Kiyomizu-dera"`**, a venue name
  in a slot that means "whereabouts". That is the symptom, verbatim.
- **The two helpers now order differently, on purpose.** `shortPlace()`
  (`lib/place.ts`) is `area ?? city ?? first segment of name`: it labels a
  *stop*, and a day inside one city is exactly where the city stops saying
  anything — four Tokyo stops rendered "Tokyo → Tokyo → Tokyo → Tokyo" where
  "Ōta → Shibuya → Nishi-Azabu → Ebisu" is the real shape of the day.
  `cityFor()` (`DayChips.tsx`) is `city ?? area`, null otherwise: it names the
  *day*, drives the day accent and the "Tokyo → Nikkō" transition, so a ward in
  that slot would split one city's days apart. **It has no `name` fallback** —
  this entry originally shipped `city ?? area ?? name`, written off a `main`
  that predated Mitchell's instruction on the #71 preview ("Never fall back to
  name, if you have absolutely no city, then make a new bucket with no city in
  title"), and the merge into `#71` resolved it to drop `name`. `area` does not
  violate that rule — a locality is a place — but a venue name does, and was
  how a restaurant came to label a whole day. Both orderings are commented at
  their call sites.
- **Grouping is untouched.** `calendarCityCards.ts` still groups strictly on
  `location.city`; nothing groups, colours, or buckets by `area`. It is
  display-only, as scoped.
- **The hand-enumeration sites.** Found by grepping every co-occurrence of
  `countryCode`/`lat`/`lng`/`city`, every `location.<field>` read and every
  `location: {` construction outside tests. Exactly one module compares a
  `Location` field by field — `packages/domain/src/trip/equality.ts` — and it
  now compares `area`, or `diffTripStates` would treat an area-only edit as a
  no-op and revert/undo would silently keep the old value.
  `diff.ts`, `hydrate.ts` and `contracts/src/detail.ts` pass `location`
  through whole and needed no change. Producers updated: the LocationIQ
  adapter, the AI geocode enrichment, `LocationInput`, the MSW handlers, the
  Japan seed importer (`stops[].area` / `unscheduled[].area` are no longer in
  `DROPPED_SEED_FIELDS`), `db-seed.ts`, and the domain property generator's
  location space.
- **Additive against a live database, tested as such.** `area` is `.optional()`
  exactly as `city` is, so a `trip_details.doc` written before this change
  still parses — `packages/contracts/test/ki35-location-area.test.ts` parses a
  full pre-`area` projection document with no `area` key anywhere and asserts
  it succeeds. That test exists because M18 added *required* fields to this
  same jsonb-returned-raw shape and 500'd every untouched board (fix commit
  `8abbaa3`); this is the tripwire for not repeating it.
- **Proof.** Every new test was mutation-checked: reverting `shortPlace`'s
  ordering fails 3 assertions across `place.test.ts` and
  `japanTripImporter.test.ts`; reverting `cityFor`'s fallback fails the
  DayChips area test; dropping `area` from `equality.ts` fails all three
  domain equality/diff assertions; dropping it from the importer or from the
  LocationIQ mapping fails their respective suites; making the contract field
  required fails the pre-`area`-document parse. Gates green from
  `/home/user/ki35-area`: `pnpm typecheck`, `pnpm lint`, `pnpm test`
  (139 domain + 53 contracts + 901 web), `pnpm test:int` (85), and
  `pnpm --filter web test:e2e:ci-like` (31 passed).
- **A third call site, found during the fix and also closed:**
  `TripBoardScreen.tsx`'s unscheduled rack computed a field it literally calls
  `area` as `location?.city ?? location?.name` — the same
  venue-name-in-an-area-slot shape, at a site this entry never named. It now
  calls `shortPlace()` like every other place line, so the rack picks up the
  new field and agrees with the timeline. Included because shipping an `area`
  field while a slot named `area` still rendered "Ugly Duck Coffee" would have
  left the entry half-true.
- **Found here, fixed here: KI-54.** `equality.ts` also omitted `city` and
  `countryCode` from its field-by-field `Location` comparison — the same
  hand-enumeration hole one field over, and a correctness bug rather than a
  cosmetic one (a city-only edit was invisible to `diffTripStates`, so
  revert/undo silently kept the old value). It was first *filed* as KI-54 on
  the reasoning that widening the comparison changes revert/undo semantics for
  two fields nobody asked about. CodeRabbit then flagged the same omission on
  PR #72 and rated it Major, which was the right correction: the list's own
  comment says every field the contract grows must be added to it, so those two
  were an omission rather than a decision. Fixed in the same PR — see KI-54,
  resolved above.
- **Severity:** cosmetic
- **Area:** `apps/web/src/lib/place.ts`, `apps/web/src/components/lenses/TimelineLens.tsx`, `packages/contracts/src/activity.ts` (`Location`)
- **First noted:** 2026-08-24 (M10 Wave 2 Phase 8, Task 8.7).
