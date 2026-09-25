### KI-2026-09-25-m — the assistant's geocoder usually leaves a travel leg's destination without coordinates, because it is outside the trip's region box

- **Severity:** correctness (a missing answer rather than a wrong one). The leg is saved, but the map draws no line for it and the conflict rule treats it as having no destination.
- **Milestone:** M24, carried rather than gating. Found by the whole-stack review of #229–#233 on 2026-09-25.
- **Area:** `apps/web/src/server/ai/geocodeEnrichment.ts`: `endLocation` goes through the same `resolveOne` / region judgment as `location`. `apps/web/src/server/geocoding/region.ts` builds the box.
- **What happens:**
  - An assistant batch resolves every place in a command against the trip's region box. On a trip with no located stops yet, that box is 150 km around the first answer.
  - A leg's destination is usually outside that box by nature: Odawara → Kyoto is about 290 km, and a flight to a new country is farther.
  - A destination outside the box comes back as the `unverified` fallback, with no `lat`/`lng`.
  - The enrichment unit test passes only because it supplies a hand-built Honshu region, and its comment says so.
- **Why not fixed in M24:** the region check exists to stop a same-named place in the wrong country from being accepted as verified. Loosening it for destinations is a policy change about that trade-off, not a bug fix. Possible answers:
  - judge a destination against its own origin plus a mode-dependent radius;
  - skip the region check for `endLocation` and rely on the hint;
  - widen the box to a country.
- **Not the same on the public API:** `resolveStopLocation` (`server/public-api/locations.ts`) passes the region only as a geocoder `viewbox`, a preference rather than a pass/fail judgment. So a far destination still gets coordinates there, though the bias could favour a same-named place near the trip. The stop editor's own place search is not batch enrichment either. Only the assistant's batch path refuses.
- **First noted:** 2026-09-25. Also recorded as a candidate by M24 part 1's implementer ("legs hit it by nature").
