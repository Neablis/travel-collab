### KI-2026-10-05-c — the library matches a city by its exact spelling, so "kyoto" never finds "Kyoto"

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
