### KI-2026-09-20-a — the trip/assistant geocode path accepts a wrong venue inside the right box, because `resolveOne` never consults KI-39's name check

- **Severity:** correctness. The failure is silent and it has shipped. A wrong venue gets renamed,
  re-pinned and reported `verified`.
- **Milestone:** none. M9 carried it (parked 2026-09-24, `docs/milestones/M9-ai-planning-partner.md`
  § *Parked 2026-09-24*), and M9's gate closed on 2026-10-06 without taking it.
- **Area:**
  - `apps/web/src/server/ai/geocodeEnrichment.ts`: `resolveOne`, `enrichCommandLocations`, and the
    module's `hintTrusted` / anchor logic.
  - `apps/web/src/server/ai/geocodeNameMatch.ts`: `placeNameVerdict`, `candidateOwnName`,
    `distinctiveTokens`, `nameTokens`.
  - `apps/web/src/server/geocoding/region.ts`: `withinBox` and `boundingBoxAround`.
  - `apps/web/src/server/savedDayPins.ts`, the working pattern for the wiring.
- **Symptom / What happens:** a location a person typed goes through `resolveOne`. So does any
  location the assistant did not ground; assistant-grounded stops, which carry `precision` beside
  real coordinates, skip the pass (KI-81). `resolveOne` accepts a candidate on distance-to-hint or
  `withinBox` alone, then overwrites `location.name` with the vendor's `canonicalName`. A per-city
  box can only reject a wrong *city*. It can't reject a wrong *venue* inside the right city.
  - Kegon Falls, Chūzenji, Nikkō resolves to Urami Falls (8 km away), and the stop is renamed,
    re-pinned and reported `verified`. That status keeps it out of `hasUnverifiedLocations` and
    lets it widen `tripRegionOf` for good (review finding F-G02, with a unit-level reproduction).
  - `geocodeNameMatch.ts`'s own examples: "Zentis Osaka, Kita, Osaka" becomes Hotels Inn Osaka
    KitaUmeda, and "Shin-Osaka Station, Yodogawa, Tokyo" becomes a different station.
  - `placeNameVerdict` was written for exactly this check (KI-39/58/77) and is tested directly.
    Its callers are the seed pipeline (`apps/web/scripts/geocode-japan-seed.mts`) and, since
    `57922bd` (#205), the Playbook map backfill in `savedDayPins.ts`. That backfill refuses a
    `"mismatch"` and pins the stop at city level. `geocodeEnrichment.ts` does not import it
    (re-checked 2026-10-17).
- **Why the suite is green:** `geocodeNameMatch.test.ts` tests the module directly, and a unit
  test of a pure module can't tell whether anything calls it. The sweep for "modules with no
  production importer" found it on 2026-09-20.
- **Fix sketch (not done):** in `resolveOne`, consult `placeNameVerdict`. A `"mismatch"` rejects
  the candidate. `"not-comparable"` falls through to today's behaviour. What a rejection does is a
  decision. Failing closed is available: a stop with no coordinates is a real outcome the map
  already handles (§16 numbers it in the list and draws no pin). The other choice is keeping the
  hint or the city-level pin, as `savedDayPins.ts` does. The fix needs a test that fails when the
  call is removed, through the geocode path. Another unit test of the module won't do.
- **Accepted residuals of the same enrichment path** (from KI-15's 2026-08-06 review). Each fails
  safe or announces itself. Each is worth knowing before it comes back as a support question:
  1. On the `verified` path, one command's hint drives a lookup shared by every command with the
     same name. The match is applied to all of them, so a second command's own coordinates can be
     discarded. Bounded: the match must fall inside the trip region if there is one.
  2. A spread-out trip (a Venice day added to a Rome-only trip) gets more `unverified` reports.
     A genuine hint for the far leg is untrusted against the established region.
  3. An `unverified` fallback is still the raw guess. It is persisted and feeds `tripRegionOf` on
     the next request like a verified one. The unverified-locations notice in `commitProposal`
     announces the widening, but doesn't prevent it.
  4. The acceptance thresholds (`MAX_REFINE_KM` 50 km, the 150 km trip margin, the 50 km hint
     margin) come from one dogfood run and haven't been measured against a corpus.
  5. `boundingBoxAround` doesn't handle the antimeridian. A trip that spans the Pacific gets no
     useful bias. That fails safe.
  6. The first lookup on a trip with no geocoded stops is `unchecked` by construction, so a wrong
     first answer survives and becomes the anchor for the rest of the batch.
- **Cross-reference:** KI-15 (merged here on 2026-10-17, moved to `resolved/` as a duplicate; it
  keeps the 2026-08-02 Rochester incident and the history of the fix); KI-39; KI-81 (resolved, the
  grounding half); F-G02, F-F12 (`docs/reviews/2026-09-05-overnight-review/findings/`).
- **First noted:** 2026-09-20.
