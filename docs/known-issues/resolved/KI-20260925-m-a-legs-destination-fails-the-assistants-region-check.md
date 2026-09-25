### KI-2026-09-25-m — the assistant's geocoder usually leaves a travel leg's destination without coordinates, because it is outside the trip's region box — RESOLVED

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

- **Fix (2026-09-25, #230, raised as a 🟠 Major by CodeRabbit's review of #230):** `f0b1676`. `enrichCommandLocations` marks which slots are destinations. A destination is judged with **no region box**:
  - With a hint from the model, the geocoder searches within 50 km of it, and a match there is `verified`. Otherwise the hint's own coordinates stay and the destination is `unverified`.
  - With no hint, the top match is taken as `unchecked`: coordinates are applied, and it is never called verified. That is the same result the first stop of a brand-new trip gets.
  - The city fallback also runs without the box.
  - A destination **never anchors** the bootstrapped region, and it is cached apart from an ordinary stop of the same name (`stop|` / `end|` keys).
  - Ordinary stops and origins keep exactly today's judgement.
  - The other options this entry listed (judging a destination against its origin with a mode-dependent radius, or widening the box to a country) were not taken, and can still be taken later.
- **Seen to fail:** before the fix, the destination of an origin → destination leg about 300 km apart, on a trip with no region, returned `expected { name: 'Kyoto Station' } to match object { name: 'Kyoto Station', …(3) }`. A flight to Narita out of a Niagara region lost its coordinates the same way. Each of the other new tests failed under its own source break: the hint still judges, a destination never anchors, it is cached apart from a same-named stop, and the city fallback runs without the box.
- **Check subset:** `pnpm --filter web typecheck`; `vitest run -c vitest.unit.config.ts src/server/ai src/server/assistant`, 33 files / 640 passed.
