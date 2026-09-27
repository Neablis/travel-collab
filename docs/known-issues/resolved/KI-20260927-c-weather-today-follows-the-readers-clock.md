### KI-2026-09-27-c — the weather block's "Today" is the reader's date, not the place's

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
