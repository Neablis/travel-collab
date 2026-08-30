### KI-60 — Every travel day produced false "impossible geography" conflicts — RESOLVED
- **Severity (as filed):** correctness (10 of the Japan demo's 12 conflicts were false, and any real user's travel day got the same treatment)
- **Area:** `packages/domain/src/trip/conflicts.ts` (`geographyRule`, new `transitExcusesDistance`)
- **Symptom (as filed):** `detectConflicts` compared **every pair** of located stops on a day against a flat `GEO_INFEASIBLE_KM` (150km) and never read `kind`, so a day where the trip legitimately relocates flagged every before/after pair:
  ```
  Day  7 (Odawara → Kyoto, 4 conflicts)   "Shinkansen Odawara → Kyoto" vs the 4 Kyoto stops   ~310 km
  Day 14 (Osaka → Tokyo,   6 conflicts)   the 2 Osaka morning stops vs the 3 Tokyo stops      ~400 km
  ```
  In every pair the day's own shinkansen was scheduled *between* the two stops. The data was right; the rule was incomplete. M18 had added `ActivityKind: "transit"` for exactly this reasoning and `conflicts.ts` predated it.
- **Fix (2026-08-28):** the entry's proposed rule. A day's `transit` stops contribute their start times; a far-apart pair is skipped when a transit stop sits **at or between** the two stops in time. "A distance is only a problem if nothing on the day accounts for crossing it."
- **Deliberately conservative in three ways**, because a false negative hides a real problem while a false positive is only noise:
  1. **Time order, not stored order.** `day.activityIds` is display order, which a user can reorder without changing when anything happens.
  2. **An untimed stop is never excused.** "We don't know when this is" is not evidence that travel covered it.
  3. **An untimed *transit* stop excuses nothing** — it cannot be placed in the interval.
  It does not check that the transit stop goes to the right *place*: nothing models a from/to (KI-59), so "some travel is scheduled in this interval" is the strongest available signal.
- **The weaker variant was rejected with evidence:** *skip a pair if either stop is `transit`* clears day 7 (transit is an endpoint of all four pairs) but only 3 of day 14's 6 — it leaves "Breakfast at the hotel" vs the three Tokyo stops, the same false positive with transit merely not being an endpoint.
- **Proof:** the Japan fixture goes **12 conflicts → 2**, and the two that remain are the wanted ones — "Nezu Museum" vs "Lunch at Kagari" and "Kiyomizu-dera and Sannenzaka" vs "Lunch at Omen Kodaiji". Confirmed in a real browser after a full `db:reset` + `db:seed`: the hero reads "2 open conflicts" and the Day-columns lens shows exactly two dismissible banners, where it previously stacked twelve (the pile KI-43 describes). No console errors.
- **Regression tests:** `packages/domain/test/conflicts.test.ts`, a new "a transit stop excuses the distance it crosses (KI-60)" block — seven cases covering between/endpoint/outside-the-interval, untimed stop, untimed transit, transit-only (every other `ActivityKind` must still flag), and that time-overlap detection is untouched. **Verified non-vacuous:** removing the one-line exclusion turns 5 of the 7 red.
- **Check subset:** full `pnpm check` (domain **153**, contracts 98, pages 32, fixtures 8, factories 354, web 1054/1 skipped) and `pnpm --filter web test:int` **201 passed** — the latter run because this is a domain change and the projection-rebuild golden test is in it.
- **Baseline moved with it:** `@tc/fixtures`'s `expectations.ts` pinned `conflictTotal: 12`; it is now `2`, with a comment saying to suspect the rule before the content if it climbs back.
- **Found by:** Mitchell, 2026-08-28, reviewing the reseeded demo trip — "I would expect one or two so the demo can see how they look but many many around distances being too far".
- **Cross-reference:** KI-59 (a stop still carries one city, so the domain still has no model of a stop that MOVES between two places — this fix routes around that rather than closing it), KI-43 (why a pile of banners matters), M18 (`kind`).
