### KI-2026-09-20-a — KI-39's wrong-venue geocode check exists, is tested, and is wired to nothing

- **Severity:** real, silent, and already shipping. Every defect KI-39 describes
  is live today: the module written to reject a wrong-VENUE geocode match has no
  caller anywhere in the repo, so nothing rejects one.
- **Milestone:** **M9, carried (assigned 2026-09-24, KI pass)** — owned by M9, not a gate box. Parked under Mitchell's 2026-09-01 rule that every open AI known issue belongs to M9; filed after that audit, so it had no owner until now. Listed in `docs/milestones/M9-ai-planning-partner.md` § *Parked 2026-09-24*.
- **Area:** `apps/web/src/server/ai/geocodeNameMatch.ts` (`placeNameVerdict`,
  `candidateOwnName`, `distinctiveTokens`, `nameTokens`) and whichever geocode
  acceptance path should consult it — `geocodeRegion.ts`'s `withinBox` is the
  check that is actually running.
- **Symptom / What happens:** `geocodeNameMatch.ts` says in its own opening
  lines why it exists: *"Name identity for a geocode candidate (KI-39) — the
  acceptance test `withinBox` (geocodeRegion.ts) structurally cannot make. A
  per-city bounding box only rejects a wrong-CITY match. It has no way to reject
  a wrong-VENUE match that lands inside the right city."* Its own examples:
  "Kegon Falls, Chūzenji, Nikkō" resolving to **Urami Falls** (a different
  waterfall in the same city), "Zentis Osaka, Kita, Osaka" to **Hotels Inn Osaka
  KitaUmeda**, "Shin-Osaka Station, Yodogawa, Tokyo" to a different station.

  All five exports are unreferenced. `grep -rn "geocodeNameMatch\|nameMatch"`
  across the whole repository — `src/**`, `scripts/**`, `packages/**`, every
  `.ts`, `.tsx` and `.mjs` — returns the module itself and its test, and nothing
  else. **The verdict is computed by nobody.**

- **Why the suite is green:** `geocodeNameMatch.test.ts` tests the module
  directly and thoroughly. A unit test of a pure module cannot tell you whether
  anything calls it, so the tests pass, the coverage looks right, and the check
  does not run in production.

- **How it was found:** not by a test, and not by reading this module. It came
  out of a sweep for *"modules with no production importer"* run on 2026-09-20
  after Mitchell found the same shape by walking the preview —
  `sharedDayGeometry.ts` had shipped with its unit test and no screen, so a
  shared Playbook day had no map (fixed in the same session, M26 link 4). The
  sweep found 16 candidates; most are test-support, instrumentation, or Next.js
  convention files. **This one and the M26 map were the two real ones.**

- **Related but NOT the same:** `OverlapWarning.tsx`, `EndOfTrip.tsx` and
  `timelineData.ts` also have no production importer, but they are orphans of
  the Timeline lens that SPEC §24 deleted — dead code to remove, not a check
  that should be running. `Board.tsx:68-75` already records that deletion and
  where the one control worth keeping went. Filed separately.

- **Fix sketch (not done):** decide where a candidate is accepted — the geocode
  write path that currently calls `withinBox` — and consult `placeNameVerdict`
  there, with `"mismatch"` rejecting the candidate and `"not-comparable"`
  falling through to today's behaviour. The interesting part is not the wiring
  but what a rejection DOES: a stop with no coordinates is a real outcome the
  map already handles (§16 numbers it in the list and draws no pin), so failing
  closed is available and is probably right for a wrong venue.

  **Whatever the fix, it needs a test that fails when the call is removed** —
  an end-to-end one through the geocode path, not another unit test of the
  module. A unit test is exactly what this entry is about.

- **First noted:** 2026-09-20.
