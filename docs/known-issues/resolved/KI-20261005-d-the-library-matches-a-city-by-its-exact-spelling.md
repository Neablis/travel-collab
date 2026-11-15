### KI-2026-10-05-d — the library matches a city by its exact spelling, so "kyoto" never finds "Kyoto" — RESOLVED

- **Severity:** minor (a day that should be offered is not; nothing wrong is shown).
- **Area:** `apps/web/src/server/nearbyStops.ts` (`nearbyStopsFor`, `d.cities && …`) and
  `apps/web/src/server/playbooks.ts` (`matchPredicate`, Discover's city filter). Both compare
  `saved_days.cities` to the asked-for cities with Postgres array overlap, which is exact and
  case-sensitive.
- **Symptom / What happens:** a published day whose stored city is spelled `kyoto` is never
  fetched for a trip whose stops say `Kyoto`, and the reverse. M34's ranking (`rankNearbyStops`)
  compares cities case-insensitively, but it only sees the rows the SQL already chose, so the
  looser rule never gets the chance to apply. Discover has the same exact match.
- **Why it is rare today:** both sides take `location.city` from the same writers (the geocoder and
  the content bundles), which write the canonical spelling. A mismatch needs a hand-typed or
  differently-sourced city on one side.
- **Fix, not made in M34:** a normalized column (for example `cities_folded text[]`, written by
  the same save path as `cities`, with its own GIN index) that both queries overlap against with
  folded keys. That is a migration plus a backfill, and it serves Discover as well as nearby
  stops, so it is its own change rather than part of #333. A `lower()` over `unnest(d.cities)`
  would fix the match but give up the GIN index, which is what keeps the query cheap. The
  accent half (`São Paulo` / `Sao Paulo`) is the same problem, and `publicLibrary.ts`'s `placeFor`
  already merges those spellings for city pages. A folded key should use that rule, not a new one.
- **First noted:** 2026-10-05, by the M34 part 2 implementer and by CodeRabbit on #333
  (`nearbyStops.ts:203-224`).
- **Re-scoped 2026-10-24 (KI sweep): the nearby-stops half is fixed, Discover's is open.**
  `nearbyStopsFor` now widens the trip's cities to every spelling a city page merges
  (`spellingsOf`: `publishedPlaces()` by `slugify`, read from the library cache) before its
  `cities &&`, and ranks with the same list. The SQL still overlaps exact strings, so the GIN
  index stays, and there is no migration. That works there because nearby stops reads only
  published days, and those are what the city pages are built from. Proven in
  `nearby-stops/route.int.test.ts` (*spelled in another case or with an accent*): a day stored
  as `nearbytown…` failed with `expected [ 'Published temple', …(5) ] to include 'Lowercase …'`,
  and with the widening stubbed out, both spellings fail. Both pass after the change.
  **Still open: Discover** (`playbooks.ts`, `matchPredicate` and `matchedCount`). The same
  widening does not carry over. Discover is entered by three paths that do not pass through
  `publicLibrary.ts` (`/api/playbooks`, the profile route and the assistant's `discoverDays`),
  so it would need an uncached read of every published day on each search, or an import cycle.
  It also searches private scopes (*Yours*, *Saved*) that the city pages do not cover, and its
  sibling chips and match count would count two spellings of one city as two cities. The
  folded column described above is still the fix for Discover.
- **Re-verified 2026-11-14 (overnight KI sweep): the Discover half still reproduces, and is left
  open because its fix is a migration.** A published day stored with `cities: ['kyototest…']`
  (lowercase) is found by `discoverDays({ cities: ['kyototest…'] })` and not by
  `discoverDays({ cities: ['Kyototest…'] })`: `AssertionError: other case: expected [] to include
  '409b7c22-…'` (a throwaway int test, not committed). The sweep's brief forbids a new Drizzle
  migration, and the folded column above is one; the no-migration alternatives are the ones this
  entry already rules out (`lower()` over `unnest`, which gives up the GIN index, or widening by
  an uncached read of every day's cities per search, which also misses *Yours* and *Saved*).
- **Resolution (2026-11-14): the folded column, generated rather than written.** Migration 0077
  adds `saved_days.cities_folded text[] GENERATED ALWAYS AS (public.tc_city_keys(cities)) STORED`
  with its own GIN index (`saved_days_cities_folded`). Generated, so it has no writer to forget:
  `cities` is set by the save path, the importer, the backfill and dozens of tests, and the same
  `ADD COLUMN` filled every existing row. `tc_city_key` is `slugify` step for step in SQL (the rule
  `placeFor` merges city pages by), falling back to the city itself when its slug is empty
  ("東京"), so an unsluggable city keeps its old exact match rather than none. `cityKey` in
  `lib/playbookUrls.ts` is the same rule in TS. `lower` runs under the ICU root collation (Unicode's
  default case mapping, which is `toLowerCase`'s), never the database locale. `playbooks.ts`'s
  `matchPredicate` and `matchedCount` overlap `cities_folded` with keys folded by `cityKey`.
  `siblingCities` and the card's `matchedCities` compare by key too, so two spellings of one city
  are one chip and one matched city. Proven in `playbooks.cityFold.int.test.ts`: before the change,
  a day stored as `kyototest…` failed with `other case: expected [] to include …`, `Sao Paulo …`
  with `accented: expected [] to include …`, and a day carrying two spellings outranked one carrying
  one. All three pass after. `cityKey.int.test.ts` holds `tc_city_key` equal to `cityKey` over
  every content-bundle city and every BMP character. A first draft that lowered after NFKD under
  `COLLATE "C"` differed on 504 code points (U+1D2C `ᴬ` and other modifier and letterlike capitals).
  `app/api/playbooks/route.int.test.ts` pinned the exact match as a decision because it was what
  the GIN index served. It now asserts the folded match. The nearby-stops path (`spellingsOf`) is
  unchanged. Production needs migration 0077 dispatched (`migrate-production`).
