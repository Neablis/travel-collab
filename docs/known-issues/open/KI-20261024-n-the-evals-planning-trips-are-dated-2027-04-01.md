### KI-2026-10-24-n — the eval's planning-phase trips are dated 2027-04-01 and stop being "planning" after that date

- **Severity:** test gap (latent). Nothing fails today; after 2027-04-01 the cases that need a
  trip in planning silently run against a trip under way or ended.
- **Area:** `apps/web/src/server/ai/eval/trips.ts` (`longTripCommands`, `startDate: "2027-04-01"`,
  about line 82; the account trips' `2027-05-01`, about line 179) and
  `apps/web/src/server/ai/eval/live.eval.ts` (the Japan trip's `startDate: "2027-04-01"` for every
  case not on the `today` trip, about lines 158 and 209); also `planRetrieval.recall.eval.ts:183`.
- **Symptom / What happens:** the day-of trip is dated from the eval's pinned clock (part 12,
  PR 545), but every other eval trip has a fixed calendar date. Once the real date passes
  2027-04-01, `tripNow` puts those trips under way and then ended: `d-near-before-the-trip`
  ("never offered `find_places_near_now`") would see the tool offered, and planning-phase cases
  would get a *now* line they were not written for. No case fails loudly; the grades just stop
  meaning what they say.
- **Why not fixed here:** found while recording part 12 on part 0 (prose only). Fix direction:
  date the planning trips relative to the pinned eval instant (for example, months after it), as
  the `today` trip already is, and assert the phase each case expects before it runs.
- **Cross-reference:** M52 box 8 (the live day-of cases); `apps/web/src/server/ai/eval/evalClock.ts`.
- **First noted:** 2026-10-24, recording part 12 (PR 545) and PR 546 on M52's part 0.
