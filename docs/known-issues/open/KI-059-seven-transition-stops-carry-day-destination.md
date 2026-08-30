### KI-59 — Seven transition stops carry their day's destination city, not the city they are physically in
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
