### KI-2026-10-24-m — the assistant's *today's city* is named for one place and located at another on a departure day

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
