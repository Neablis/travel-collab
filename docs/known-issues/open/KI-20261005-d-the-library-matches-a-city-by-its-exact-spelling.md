### KI-2026-10-05-d — the library matches a city by its exact spelling, so "kyoto" never finds "Kyoto"

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
