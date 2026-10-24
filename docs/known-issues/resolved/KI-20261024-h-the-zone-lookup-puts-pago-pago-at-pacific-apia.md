### KI-2026-10-24-h — the zone lookup puts Pago Pago at `Pacific/Apia`, a calendar day away — RESOLVED

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
- **Resolved:** 2026-10-24, KI sweep. Reproduced on the installed `@photostructure/tz-lookup`
  11.7.0: Pago Pago (`-14.2794, -170.7006`) and Leone on Tutuila returned `Pacific/Apia`, and a
  sweep of the region found a second date-line error of the same kind, Fakaofo, Tokelau
  (`-9.3803, -171.2181`, UTC+13) returning `Pacific/Pago_Pago`. The grid draws the Samoa /
  American Samoa border at about 170.63°W (through Tutuila) and the Tokelau one at about 9.35°S
  (through Fakaofo). `timeZoneAt` now checks a two-row `DATE_LINE_CORRECTIONS` table of boxes,
  each spanning only the open sea between the two territories' nearest islands, before the grid.
  Proof: a new `timeZones.test.ts` case of fifteen real towns either side of the line (Pago Pago,
  Leone, Aunu'u, Ta'u, Swains, Apia, Lalomanu, Salelologa, Fakaofo, Nukunonu, Atafu, Nuku'alofa,
  Alofi, Mata-Utu, Suva) was seen red before the fix (`Pago Pago: expected 'Pacific/Apia' to be
  'Pacific/Pago_Pago'`), and red again with only the Fakaofo row removed (`Fakaofo: expected
  'Pacific/Pago_Pago' to be 'Pacific/Fakaofo'`); green with both.
