### KI-2026-10-24-h — the zone lookup puts Pago Pago at `Pacific/Apia`, a calendar day away

- **Severity:** correctness. American Samoa is `Pacific/Pago_Pago` (UTC−11) and Samoa is
  `Pacific/Apia` (UTC+13): the same clock time a whole date apart. A trip there reads today,
  stop times and the countdown on the wrong day.
- **Area:** `apps/web/src/server/timeZones.ts` `timeZoneAt` over `@photostructure/tz-lookup`,
  which feeds `TripGlobalsDay.timeZone` (ADR-080) and the weather days.
- **Symptom / What happens:** `tzLookup(-14.2794, -170.7006)` (Pago Pago) returns
  `Pacific/Apia`; checked against `main`'s installed dependency on 2026-10-24. So even correct
  coordinates for Pago Pago get Samoa's zone.
- **Why not fixed here:** prose-only part 0. `timeZones.ts` already says the lookup is lossy near
  borders and that geo-tz is exact but ~70 MB. Options: a short override table for known small
  island zones the coarse grid merges (checked by a test of real city points), or a bigger
  lookup if one fits the function. A test of Pago Pago, Apia and a few other date-line cities
  should come first and be seen red.
- **Cross-reference:** ADR-080 (the zone each day runs on); KI-2026-09-25-n (the content
  geocoder).
- **First noted:** 2026-10-24, M52.
