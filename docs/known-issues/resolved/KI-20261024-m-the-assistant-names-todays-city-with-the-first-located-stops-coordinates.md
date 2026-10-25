### KI-2026-10-24-m — the assistant's *today's city* is named for one place and located at another on a departure day — RESOLVED

- **Severity:** correctness (minor). The assistant may answer "near me" questions about the wrong
  place on the day a trip leaves.
- **Area:** `apps/web/src/server/assistant/context.ts` (`turnNowOf`'s return, about line 194:
  `cityName = today?.place?.city ?? today?.cities[0]`, with `today?.place?.lat/lng`).
- **Symptom / What happens:** on a departure day whose first located stop is a flight out of the
  home airport (coordinates, no city) and whose first city is Tokyo, the turn's context names the
  city "Tokyo" but gives it the home airport's coordinates, because `place` (the day's clock: the
  earliest located stop) has no city and the name falls back to `cities[0]`. Pre-existing: `main`
  did the same before PR 542; review round 3's version would have changed it and round 4 restored
  `main`'s.
- **Why not fixed here:** out of PR 542's scope (sun and weather), and it is the assistant's
  context, not a widget. Fix direction: read the city's name and coordinates together from
  `TripGlobalsDay.weatherPlace` (one stop, one rule: `placesOfDay`), keeping `place`/`timeZone`
  for the clock; or name the city only when `place.city` is set.
- **Cross-reference:** M52 decision 10 (where the sun and the weather are read); ADR-080's
  amendments of 2026-10-24; `docs/contracts/CHANGELOG.md`, 2026-10-24, `weatherPlace`.
- **First noted:** 2026-10-24, review of PR 542, round 4 (finding 3), at `d717423`.
- **Resolved:** 2026-10-24, KI sweep, by the entry's first direction. `turnNowOf` now takes the
  city's name and point together from `TripGlobalsDay.weatherPlace` (one stop, `placesOfDay`);
  `place`/`timeZone` still drive the clock. A day whose city has no located stop keeps
  `cities[0]` as the name with `lat`/`lng` null, so `find_places_near_now` gets no point rather
  than another stop's. Proof: two new `context.test.ts` cases (a JFK-clock, Tokyo-sky departure
  day; a Kyoto day whose only located stop is JFK) were seen red before the fix, `expected { name:
  'Tokyo', lat: 40.6413, …(1) } to deeply equal { name: 'Tokyo', lat: 35.6812, …(1) }` and
  `expected { name: 'Kyoto', lat: 40.6413, …(1) } to deeply equal { name: 'Kyoto', lat: null,
  lng: null }`, and pass after it. The suite's `inTokyo` fixture gained the `weatherPlace` field
  `buildTripGlobals` always sets (it was cast past the type without one).
