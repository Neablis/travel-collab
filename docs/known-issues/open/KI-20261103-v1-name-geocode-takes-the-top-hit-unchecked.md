### KI-2026-11-03 — a v1 stop write geocodes a name to the vendor's top hit with nothing checking it, so Ria's Wines was pinned in Atlanta

- **Severity:** correctness. Silent: the write succeeds, `Geocode-Outcome: name` says it was geocoded,
  and the map shows a venue-shaped pin in the wrong place.
- **Area:**
  - `apps/web/src/server/public-api/locations.ts`: `resolveStopLocation`, the name branch.
  - `apps/web/src/server/geocoding/locationiq.ts`: `forward`, which retries a miss with no country
    filter, and `search`, which sends the trip's box as a `viewbox` without `bounded=1`.
  - `apps/web/src/app/api/v1/trips/[tripId]/activities/route.ts` and `.../[activityId]/route.ts`,
    the two writes that call it.
- **Symptom / What happens:** an agent creating stops through the CLI (v1 `POST`/`PATCH` on
  `/activities`) sent a location with a `name` and no coordinates. Ria's Wines was stored in
  Atlanta, nowhere near the trip.
  - `resolveStopLocation` asks for `limit: 1` and stores whatever comes back. It never compares the
    answer with the trip's region or with the name that was asked for.
  - The trip's region only *biases* the ranking: `viewbox` without `bounded=1` (`locationiq.ts`).
  - The trip's countries do filter, but `forward` retries a miss with no filter at all (Mitchell,
    2026-09-30, option A: *the trip's countries are a hint, not a wall*). So a venue that OSM does not
    hold in the trip's country is answered with the best-ranked same-named place anywhere in the world.
  - On a trip with no located stops there is no region and no country list, so nothing biases the
    lookup at all.
- **Why the AI path does not do this:** `geocodeEnrichment.ts` (`resolveOne`) accepts a match only
  when it agrees with the trip's region or the model's own coordinates, and otherwise keeps what it
  had and reports it (KI-15). v1 was written later (2026-09-18) with its own resolver and none of
  that check: the bug sits in the gap between two resolvers.
- **Exact reproduction:** not captured. The CLI transcript that produced the Atlanta pin was not kept,
  so whether it came from the unbounded viewbox, the unfiltered retry, or a trip with no region is
  not known. Each of the three reaches the same unchecked `limit: 1`.
- **Fix path:** judge the v1 name lookup with the same rule as the AI path. The rule lives in one
  shared module, so the two cannot drift again. A match has to sit in the trip's region and its own
  name has to agree with the stop's (`placeNameVerdict`, KI-39). A rejected match is not stored.
  Fall back to the stop's city at city precision where it can be corroborated, otherwise save
  without coordinates and say so in `Geocode-Outcome`.
- **Cross-reference:** KI-2026-09-20-a (the AI path's own missing name check), KI-15 (resolved, the
  AI path's region check and its history), KI-39 (the name check), ADR-007.
- **First noted:** 2026-11-03, from an agent's review of the location API after a CLI session.
