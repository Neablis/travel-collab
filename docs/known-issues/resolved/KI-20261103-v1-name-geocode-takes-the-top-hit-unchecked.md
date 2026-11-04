### KI-2026-11-03 — a v1 stop write geocodes a name to the vendor's top hit with nothing checking it, so Ria's Wines was pinned in Atlanta — RESOLVED

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
- **Resolution (2026-11-03):** the fix path above, done in the same branch that filed this.
  `placeAcceptance.ts` (`apps/web/src/server/ai/`) holds the rule, and both `resolveStopLocation` and
  the assistant's `resolveOne` call `judgeMatch`. A v1 name lookup's answer must not carry a
  different place's name, and must sit in the trip's region unless the caller named a country the
  trip has no stop in yet (the first stop in a new country, which the API guide promises resolves by
  name). A trip's own country does not lift the region: "US" on a Finger Lakes trip would admit
  Atlanta. A refused answer falls back to the stop's `city` and `countryCode` at `precision: "city"`
  (`Geocode-Outcome: city`), else no coordinates (`rejected`). A leg's `endLocation` is judged
  without the region, as the assistant judges it. Tests: `locations.test.ts`, *a name lookup's answer
  is judged before it is stored*, each seen red with its part of the fix removed.
  - **What it costs, knowingly:** a stop named for an activity rather than a venue ("Dinner at
    Ria's") no longer matches the venue's name, so it gets its city or no pin instead of the venue.
    A second city in a country the trip is already in, sent by name with no `city`, is `rejected`
    when it is more than 150 km from the trip's stops. The caller sends coordinates or a candidate
    from `GET /v1/trips/{tripId}/geocode`.
  - **Review of PR 686, fixed in the same PR:** the new-country exception reads the countries of
    the stops the region is drawn around (a leg's far end does not count); the city fallback faces
    the same region as the venue answer; a PATCH leaves the stop's own current pin out of the region,
    so this very trip's Atlanta pin cannot admit Atlanta again (`resolveContextOf`); and a name that
    holds an address, or puts its venue after a comma, is no longer refused for it.
  - **Mitchell, 2026-11-03:** a `city` the caller names loosens the region, for the venue answer
    and the city fallback alike (`inNamedCity`, no extra lookup). This undoes part of the review's
    finding 2 on purpose: a named "Springfield" can be pinned in the wrong state. And a pin taken
    that way is one of the trip's stops from then on, so it widens the region for every later
    lookup: after a Springfield, IL city pin on the Finger Lakes trip, a name lookup with no city
    that lands in Pittsburgh is inside the box and accepted (second review of PR 686, finding 1).
  - Same branch: a location key the schema does not know (`latitude`, `lon`, `zip`) is a 400 on both
    v1 stop writes (`LocationWrite`) instead of being dropped and the name geocoded over it.
- **Cross-reference:** KI-2026-09-20-a (the AI path's own missing name check), KI-15 (resolved, the
  AI path's region check and its history), KI-39 (the name check), ADR-007.
- **First noted:** 2026-11-03, from an agent's review of the location API after a CLI session.
