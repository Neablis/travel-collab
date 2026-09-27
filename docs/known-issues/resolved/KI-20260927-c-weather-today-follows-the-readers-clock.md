### KI-2026-09-27-c — the weather block's "Today" is the reader's date, not the place's — RESOLVED

- **Severity:** UX, visible for readers far from the trip. A reader in San Francisco
  looking at a Kyoto trip sees Kyoto's "today" row on the wrong day, without the Now
  column, for most of each day.
- **Area:** `apps/web/src/components/pages/blocks/WeatherBlock.tsx` picks the row with
  `useToday()`, which is `localTodayIso()` in `apps/web/src/lib/today.ts`: the
  **browser's** calendar date (`getFullYear/getMonth/getDate`).
- **Symptom / What happens:** walked on #256's preview at 16:03 UTC on 2026-09-27, when
  it was 01:03 on the 28th in Kyoto.
  - Browser in `Asia/Tokyo`: Day 2 read "Today · Heavy rain", with a Now column.
  - Browser in UTC: Day 1 read "No forecast · Sep avg", Day 2 "Forecast · Heavy rain",
    and there was no Now column.
- **Decision needed (Mitchell):** is "today" the place's date (each row's city's time
  zone, which the stop's coordinates or city already imply) or the reader's? For a
  forecast of a place, the place's date is the usual answer. Other callers of `useToday()`
  may rightly stay on the reader's date; check each one before changing the helper.
- **Why not fixed here:** it is a product decision, and it touches a shared helper.
- **Decision (Mitchell, 2026-09-27, verbatim):** *"Location that a trip should be in in that
  day, not the readers current location"*. "Today" is the date at the row's place.
- **Where it was actually decided:** not in `WeatherBlock.tsx` — its `useToday()` only dates
  the as-of, which stays in the reader's zone (ADR-052 decision 7). The mode was chosen in the
  `day.weather` resolver (`packages/pages/src/macros/primitives/weather.ts`) from `ctx.today`,
  which `MacroView`/`RepeatNodeView` fill from `useToday()`. The route already knew each
  point's zone and never sent it.
- **Fix:** `TripWeatherPoint.placeToday` (optional; contracts CHANGELOG 2026-09-27) is set by
  `buildTripWeather` in the point's own zone at the instant the "now" hour was cut; the
  resolver compares each point with it, and falls back to (and waits for) the reader's date
  only for a point without one. `useToday()` and its other callers are untouched. ADR-052
  amended 2026-09-27.
- **Reproduced on main (`d0d1e68`)**, `tripWeather.test.ts` "the place's today, not the
  reader's", route service + resolver at 2026-09-27T16:03Z: reader in UTC, Kyoto — Day 2 read
  `"Forecast", null` where `"Today", "26°"` was expected (the KI's walk exactly); reader in
  Tokyo, Honolulu — Day 1 read `"Past day · Sep avg"` and Day 2 `"Today", "20°"` (Honolulu's
  midnight as "now").
- **Seen to fail (`pnpm redfirst`):** resolver `(point.placeToday ?? today)!` → `today!` —
  three `weather.test.ts` cases red, e.g. *"expected [ 'Forecast' ] to deeply equal [ 'Today'
  ]"*; server `localOf(zone, …).date` → `isoDay(…)` (UTC) — the Kyoto case red, Day 2
  `"Forecast", null`. Both restored and green.
- **Check subset:** full `pnpm check` (contracts changed): typecheck, lint, all unit suites
  green; `pnpm --filter web test:int` 86 files / 1100 tests green;
  `pnpm --filter web test:e2e:ci-like e2e/m14-notebook-widgets.spec.ts -g weather` 3 passed.
- **Follow-up (2026-09-27): the route int test's clock.** The fix left
  `route.int.test.ts` dating its Oslo trip by UTC, so from 22:00 UTC (US afternoon/evening)
  "with only the forecast down…" read `"Past day · Sep avg"`. #263 dated it in Oslo; that still
  broke all 7 cases on the eve of a spring-forward (`+ n * 24h` skips the 23-hour day) and
  could race Oslo's midnight. The test now dates day 0 as the route does
  (`clockIn(timeZoneAt(…), now)`), adds days on the calendar, and pins `Date` to
  2026-09-27T23:41Z — the instant it was reported failing. Product code unchanged.
