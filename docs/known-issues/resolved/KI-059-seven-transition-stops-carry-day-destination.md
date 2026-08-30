### KI-59 — Seven transition stops carry their day's destination city, not the city they are physically in — RESOLVED
- **UNBLOCKED 2026-08-29 by M18's gate — the enabling change below has landed.
  Two sessions reached this entry from opposite ends on the same day; this
  paragraph reconciles them.** The other session corrected all seven rows,
  measured the result as a regression, and reverted it — see "ATTEMPTED AND
  REVERTED" below. Its stated prerequisite was: *"a day's city must come from
  where the day **ends**, not from its first stop… `cityFor()` can take the
  day's last stop instead of its first. Correct these seven rows in the **same**
  change as that, never before it."* **`cityFor()` now reads a day's LAST
  city-bearing stop** (M18, Mitchell's day-label rule). So the specific
  regression that was measured — every corrected first-stop retagging its whole
  day, Nikkō vanishing from the chips — should no longer occur, because a day's
  label now comes from where it ends. **That is a prediction from the mechanism,
  not a measurement: nobody has re-run the correction since `cityFor` changed.**
  Re-run it before believing it.
- **One half of that prerequisite did NOT land, and deliberately so.** The same
  paragraph also expected `calendarCityCards.ts` to split a travel day at its
  last `transit` stop. That split was built, walked, and **removed** at M18's
  gate: it fired on one of seven travel days and got that one wrong, and its
  output depended on this very entry's tagging convention — *"I don't think the
  shape of the fixture should drive functionality, that's how we get drift"*
  (Mitchell, 2026-08-29). The Calendar now groups by city alone. So a correction
  here no longer has a transit rule to coordinate with; it only has to not break
  day accents and the city cards, which is a smaller question than the entry has
  carried until now. Full account: `docs/milestones/M18-stop-kind.md`.
- **Also worth carrying forward:** KI-60 already removed the conflict-baseline
  obstacle this entry was originally filed against, and `upstreamDrift.test.ts`
  is the newer one — it asserts `JapanStop.city` equals the export's
  `days[].city`, so any correction must also declare that `city` is no longer
  carried verbatim from upstream.
- **Severity:** cosmetic / design decision (deliberate, longstanding, and product-visible; recorded so it is a choice rather than an accident)
- **Area:** `packages/fixtures/src/japan/trip.ts` (`JapanStop.city`), `packages/fixtures/src/japan/commands.ts` (`locationName`, which folds `city` into `Location.name`)
- **Symptom:** a day is tagged with the city it arrives in, so a stop that begins the journey is labelled with the destination. Seven rows:
  ```
  day  4  Tobu Asakusa Station   tagged Nikkō     "Limited Express to Nikkō"
  day  6  Shinjuku Station       tagged Hakone    "Romancecar to Hakone-Yumoto"
  day  7  Odawara Station        tagged Kyoto     "Shinkansen Odawara → Kyoto"
  day 11  Kyoto Station          tagged Osaka     "Train Kyoto → Osaka"
  day 13  Uno Port               tagged Naoshima  "Train and ferry to Naoshima"
  day 14  Zentis Osaka           tagged Tokyo     "Breakfast at the hotel"
  day 14  Shin-Osaka Station     tagged Tokyo     "Shinkansen to Tokyo"
  ```
  `city` lands on both `Location.city` and, via `locationName`, inside `Location.name` — so the stored label reads `"Zentis Osaka, Kita, Tokyo, Japan"` for a hotel in Osaka.
- **Why it is filed rather than fixed:** it is the fixture's stated convention, inherited from `db-seed.ts` where the day-14 case was reasoned out explicitly — splitting that day produced "a pile of 'same day, ~400km apart' distance warnings ... accurate but noisy for a fixture". `cityFor()` names and colours a day from its activities' `city`, and `calendarCityCards.ts` groups strictly on it, so splitting these seven would change day accents, the calendar's city cards, and the 12-conflict baseline `pnpm seed:verify` pins. That is a product decision about how a travel day is modelled, not a mechanical correction — the same class as KI-39's note that the seed's coordinates are "a product-visible data decision".
- **The real question underneath it:** the domain has no concept of a stop that moves between two places. `ActivityKind: "transit"` says a stop *is* travel but not where it goes. Until there is a from/to, any single `city` on a transit stop is a lie in one direction or the other; the current convention at least makes the lie consistent.
- **Fix path, if taken:** give a transit stop the city it departs from and let the day derive its label from the majority or the last stop — or model an origin/destination pair on the activity, which is a contract change and its own reviewed step.
- **ATTEMPTED AND REVERTED, 2026-08-29 — the correction alone is a regression, now measured.** All seven rows were corrected to the city the stop is physically in and the day chips recomputed. `cityFor()` (`DayChips.tsx`) reads the day's **first** located activity, and all seven of these rows are their day's first stop, so each one retags its entire day:
  ```
  day  4  Nikkō    -> Tokyo      the Nikkō day trip stops saying Nikkō
  day  6  Hakone   -> Tokyo
  day  7  Kyoto    -> Hakone
  day 11  Osaka    -> Kyoto
  day 14  Tokyo    -> Osaka      the fly-home-from-Tokyo day says Osaka
  ```
  **Nikkō disappears from the trip's chips altogether** (six cities become five) and every transition badge lands one day late — Tokyo→Hakone on the Kyoto day, Kyoto→Osaka on day 12. So the data fix makes the demo visibly *wrong in a new way*, and the entry's original judgement holds after both M18 and KI-60.
- **What has changed since it was filed, and what has not.** KI-60 removed one of the three stated obstacles: the conflict baseline is **not** affected, because conflicts are computed from `lat`/`lng`, which were always physically correct — `seed:verify` still reports 2 conflicts with all seven rows corrected. `upstreamDrift.test.ts` is a second, newer obstacle: it asserts `JapanStop.city` equals the export's `days[].city`, so any correction here must also declare that `city` is no longer carried verbatim from upstream. The day accents and the calendar cards remain the real blocker.
- **The enabling change, and it is downstream:** a day's city must come from where the day **ends**, not from its first stop. M18 shipped `kind`, so `calendarCityCards.ts` can now do what its own comment has always said it would — split a travel day at its last `transit` stop — and `cityFor()` can take the day's last stop instead of its first. Correct these seven rows in the **same** change as that, never before it. Touching `packages/fixtures` alone cannot close this entry.
- **Found by:** CodeRabbit's review of PR #74, 2026-08-28. Rationale restored into `trip.ts`'s `JapanStop.city` doc comment in the same PR (it had been lost when the rows moved out of `db-seed.ts`); the 2026-08-29 measurement above is recorded there too.
- **Cross-reference:** KI-35 (`area` exists because `name` alone could not carry locality), ADR-030.
- **First noted:** 2026-08-28 (PR #74 review).

---

- **Resolved 2026-08-30.** Mitchell, asked about the product-visible
  consequence: *"Go ahead and fix, i want honesty, not keeping past data the
  same."* The entry had been carried as a recorded design decision; it is
  closed as a defect.
- **Reproduced first, from the fixture's own coordinates** rather than from the
  entry's list. For each of the 68 scheduled stops, the distance from its
  `lat`/`lng` to each of the trip's city reference points: exactly **seven**
  stops were nearer some other city than the one they were tagged with — the
  seven the entry names, no more and no fewer. `d13-s5-ferry-and-train-back-to-osaka`
  was checked explicitly and is **correct**: it departs Miyanoura Port, which
  is on Naoshima, so its day's city and its departure city already agree.
  ```
  d4-s1-limited-express-to-nikko     tagged Nikkō     112.6km away; Tokyo 4.5km
  d6-s1-romancecar-to-hakone-yumoto  tagged Hakone     74.0km away; Tokyo 6.1km
  d7-s1-shinkansen-odawara-kyoto     tagged Kyoto     310.3km away; Odawara 0.2km
  d11-s1-train-kyoto-osaka           tagged Osaka      39.6km away; Kyoto 0.0km
  d13-s1-train-and-ferry-to-naoshima tagged Naoshima    5.4km away; Tamano 0.2km
  d14-s1-breakfast-at-the-hotel      tagged Tokyo     403.4km away; Osaka 0.6km
  d14-s2-shinkansen-to-tokyo         tagged Tokyo     401.7km away; Osaka 3.4km
  ```
- **Cause:** `city` was not a stop fact at all. Upstream models it as
  `days[].city` and tags a day with its DESTINATION; `trip.ts` denormalised
  that onto every stop, so the first stop of a travel day claimed a city the
  traveller had not reached — and `d14-s1`, a hotel breakfast, claimed one 400km
  away.
- **Fix:** a third override map beside `kindOverrides.ts` and
  `coordinateOverrides.ts` — **`packages/fixtures/src/japan/cityOverrides.ts`**,
  `CITY_OVERRIDES`, seven entries each recording the upstream value, ours, and
  the geography that decides it. `trip.ts` carries the corrected values and its
  `JapanStop.city` doc comment now states that `city` is no longer verbatim from
  upstream. `upstreamDrift.test.ts` compares `city` against
  `CITY_OVERRIDES[id]?.ours ?? days[].city` and gained the same staleness guard
  the kind overrides have (an entry naming a missing stop, recording a stale
  upstream city, not actually applied, or overriding to the value it already had
  fails the suite).
- **Product-visible consequence, verified by running the real
  `calendarCityCards` and `chipModel` over `demoTripDetail()` before and after:**
  six days now render **two** city cards where they rendered one —
  `4 Tokyo(1)+Nikkō(4)`, `6 Tokyo(1)+Hakone(4)`, `7 Odawara(1)+Kyoto(4)`,
  `11 Kyoto(1)+Osaka(4)`, `13 Tamano(1)+Naoshima(4)`, `14 Osaka(2)+Tokyo(3)`.
  `citiesOfDay`'s list (packages/domain) is now genuinely multi-valued, as its
  own comment always said it could be. **Day chips, day accents and every
  transition badge are byte-identical to before** on all fourteen days, Nikkō
  included — the 2026-08-29 regression this entry records does not recur,
  because `cityFor()` reads a day's LAST located activity (M18) and every one
  of these days still ends in the city the export named.
- **Baseline moved, once:** `expectations.ts`'s `cities` went from six to eight
  — `Odawara` and `Tamano` join, because that is where the day-7 and day-13
  mornings physically start. `seed:verify` reported that as its only finding;
  every other number (68 stops, 2 conflicts, 3 days needing booking, kinds,
  tags, coordinates, costs) was unchanged, since conflicts read `lat`/`lng` and
  those were never wrong.
- **Regression test:** `packages/fixtures/src/japan/cityGeography.test.ts` —
  coordinate-based, not a re-statement of the seven: no stop may sit closer to
  another city's stops than to its own. **Verified non-vacuous**: reverting
  `d14-s1` to `Tokyo` turns it red with the exact row named. It catches six of
  the seven original rows; `d13-s1` (Uno Port, 5km of water from Naoshima)
  survives it, and the test says so rather than overclaiming.
- **A test that encoded the old assumption, corrected not weakened:**
  `apps/web/src/server/ai/readTools.test.ts` asserted day 7 was `["Kyoto"]` and
  day 11 `["Osaka"]`. Those days start at Odawara Station and Kyoto Station, so
  the old assertion was the one-city-per-day belief, not a fact about the trip.
  It now asserts `["Odawara", "Kyoto"]` and `["Kyoto", "Osaka"]` plus "five days
  touch Kyoto" — strictly more than it checked before.
- **Check subset:** `pnpm --filter @tc/fixtures test` (11 passed, 3 files),
  `pnpm --filter @tc/fixtures typecheck`, `pnpm --filter @tc/domain test` (221
  passed), `pnpm --filter @tc/factories test` (354 passed, a downstream consumer
  of this fixture), `pnpm --filter web typecheck`, `pnpm --filter web lint`, and
  `pnpm --filter web exec vitest run -c vitest.unit.config.ts` (138 files, 1720
  passed / 1 skipped). **Not run:** `pnpm check`, `test:int` and e2e — run
  serially by the owner. `e2e/m16-assistant.spec.ts` and
  `e2e/m18b-tag-focus.spec.ts` were read: both only touch days 1-2, which are
  wholly in Tokyo and unchanged.
- **Left alone, deliberately:** `apps/web/scripts/geocode-japan-seed.mts` reads
  the UPSTREAM export directly (`days[].city`), not `trip.ts`, so its next live
  run would still send the seven unsatisfiable queries. Teaching it
  `CITY_OVERRIDES` also needs viewboxes for Odawara and Tamano and a re-review
  of ~70 live lookups — KI-58-shaped work, not a rider on this. Its own
  comment about "expected misses under this method" is now the only place the
  old convention is still described as correct.
- **First noted:** 2026-08-28 (PR #74 review). **Resolved:** 2026-08-30.
