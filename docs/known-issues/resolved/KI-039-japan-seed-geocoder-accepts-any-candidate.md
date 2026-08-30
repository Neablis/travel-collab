### KI-39 — The Japan seed's geocoder accepts any candidate inside the right city, not the right venue — RESOLVED
- **Severity:** correctness (a confidently wrong pin, same family as KI-15)
- **Area:** `apps/web/scripts/geocode-japan-seed.mts`,
  `apps/web/src/lib/japanTripSeedCoordinates.json`
- **Symptom:** the script's acceptance test (`withinBox`, a per-city bounding
  box — see the script's own header comment) only rejects a wrong-*city*
  match; it has no way to reject a wrong-*venue* match that happens to fall
  inside the correct city's box. Three of the 54 stops the script originally
  resolved were exactly that: a plausible-sounding, in-city LocationIQ result
  for the wrong place. All three were hand-verified and their entries deleted
  from the overlay (CodeRabbit's final PR #46 review, 2026-08-25) rather than
  shipped:
  - `d4-s4-kegon-falls` resolved to "Urami Falls, Nikko…" — a different
    waterfall in the same city.
  - `d11-s2-check-in-at-zentis-osaka` resolved to "Hotels Inn Osaka
    KitaUmeda…" — a different hotel in the same city.
  - `d14-s2-shinkansen-to-tokyo` resolved to Shinagawa Station — the wrong
    Shinkansen station; the real stop is Shin-Osaka.
  The overlay now carries 51 of the seed's 72 stops (down from 54); those
  three stops render no pin rather than a wrong one, which is the standing
  principle this branch established for `MapLens` — a missing pin is fine, a
  confidently wrong one is not.
- **Why not fixed here:** a name-identity check (e.g. requiring the
  candidate's own name/address to match the queried place, not just its
  coordinates falling in a box) is real design work on a script that already
  does one offline, hand-verified pass — not a mechanical fix, and explicitly
  deferred rather than bundled into a CodeRabbit-response task.
- **Fix path:** before the overlay is ever regenerated, add a name-identity
  check alongside `withinBox` — e.g. a fuzzy match between the queried place
  name and the candidate's returned `display_name`/address components —
  rejecting a same-city, different-venue candidate the box alone can't catch.
- **Cross-reference:** KI-15 — same family ("a plausible wrong location is
  worse than none"), different call site (live AI enrichment vs. this offline
  one-off script).
- **Fix (2026-08-28):** the name-identity check the fix path asked for, as a
  pure predicate — `placeNameVerdict`
  (`apps/web/src/server/ai/geocodeNameMatch.ts`, new; a sibling of
  `geocodeRegion.ts` rather than an addition to it, since that module's header
  promises arithmetic). Every *distinctive* token of the queried place — its
  own name minus category nouns ("Falls", "Station", "Hotel") and minus the
  geography already in the query (area, city, country) — must appear as a token
  of the candidate's own name (`display_name`'s leading segment). ALL tokens,
  not any: "Bread & Espresso" vs. "Cawaii Bread & Coffee" shares exactly one.
  The verdict is three-valued, and that is the load-bearing design decision:
  LocationIQ answers a romanised query with the object's *local-script* name
  whenever OSM has no `name:en` ("Meiji Jingū" -> 明治神宮), which is
  `not-comparable`, not `mismatch` — 29 of the 54 original resolutions look
  like that and every one is the right place. The script
  (`geocode-japan-seed.mts`) applies it after `withinBox`, prefers a
  name-verified candidate over a higher-ranked unverified one, reports rejects
  under "In the box but a different venue", and now prints an explicit
  "accepted but name-unverified" list so the next human pass knows which pins
  rest on the box alone.
- **Proof:** reproduced first — the real script run against the vendor rows
  the 2026-08-25 pass actually recorded (recovered from commit `7fb5da2`'s
  overlay, `fetch` stubbed, no live API): before, it wrote all three
  hand-caught wrong venues into the overlay ("Resolved 3/72"); after, "Resolved
  0/72 … 3 in box but wrong venue", each listed with the rejected candidate. A
  positive control in the same harness (Meiji Jingū local-script, Gōra Kadan
  romanised) still resolves, so the check does not simply reject everything.
  Replayed over all 54 of that run's resolutions offline: 11 mismatches — the
  3 deleted plus 8 more the same run shipped (see below) — 14 matches, 29
  not-comparable, and **no correct match rejected**. Regression test:
  `apps/web/src/server/ai/geocodeNameMatch.test.ts`, a table of those real
  vendor answers (37 cases). Checks run: `pnpm --filter web typecheck`, `pnpm
  --filter web lint`, `pnpm --filter web exec vitest run -c
  vitest.unit.config.ts src/server/ai/geocodeNameMatch.test.ts
  src/server/ai/geocodeRegion.test.ts src/lib/japanTripImporter.test.ts` (3
  files, 62 tests, all passing).
- **Found while proving it, deliberately NOT fixed here:** the same wrong-venue
  failure is *already shipped* in the committed overlay in eight more places
  the hand pass missed — `d2-s4-hama-rikyu-gardens` -> "Tokyo, Chiyoda",
  `d2-s5-yakitori-at-torishiki` -> "MeGuro, Shinagawa",
  `d3-s1-breakfast-at-bread-espresso` -> "Cawaii Bread & Coffee",
  `d3-s3-lunch-at-afuri` -> "WITH HARAJUKU", `d5-s5-omakase-at-sushi-yoshitake`
  -> "Sushi Wasabi, Shinjuku", `d7-s5-dinner-at-gion-nanba` -> "GION KIMUTAKO",
  `d9-s3-lunch-at-yoshida-ya` -> "Coffee Yoshida",
  `d9-s5-dinner-at-kichi-kichi` -> "KICHIRI 河原町店". The new check rejects all
  eight (they are the regression table's second block), so a regeneration drops
  them — but deleting eight demo pins from
  `japanTripSeedCoordinates.json` is a product-visible data decision, not this
  fix, and this task was scoped to one KI — handed back to the session that
  dispatched it to file or schedule.
- **First noted:** 2026-08-25 (M10 Wave 2 Phase 8b, PR #46's final CodeRabbit
  review round). **Resolved:** 2026-08-28.
