### KI-2026-09-24-o — the app now sends rounded stop locations to weather providers, and no page tells the reader so

- **Severity:** minor (disclosure) — wider since 2026-09-26, see the last entry. ADR-052's Consequences ask for a line saying that the Weather widget sends a rounded location (2 decimals, about 1 km) to MET Norway and NASA POWER. The app has no privacy page to put it on.
- **Milestone:** M14, carried rather than gating. Filed on PR #221 with T24.
- **Area:** `apps/web/src/server/external/` (what leaves the building: `roundForExport`, the User-Agent carrying `EXTERNAL_DATA_CONTACT`), and the missing privacy/data page.
- **Symptom / What happens:** a reader who inserts "Weather" has a rounded stop location sent to two third parties, and nothing in the product says so. The block's footer credits the sources but does not describe what is sent.
- **Why not fixed here:** a privacy page is a product and legal surface, not a widget change. Mitchell accepted the data flow on 2026-09-24; the wording of the disclosure is his.
- **First noted:** 2026-09-24, M14 T24.
- **Re-verified 2026-09-25 (overnight sweep):** still true. No privacy, legal or
  terms route exists under `apps/web/src/app` (`find -ipath '*privacy*'` etc.
  returns nothing), and the only product mentions of MET Norway / NASA POWER
  are `WeatherBlock.tsx`'s source credit. `roundForExport` is still the sole
  constructor of an exportable point (`apps/web/src/server/external/roundedPoint.ts:29`);
  `EXTERNAL_DATA_CONTACT` is read in `server/config.ts:23` and required by
  `external/weather/index.ts:43`.
- **Widened 2026-09-26 (PR #243): weather is now fetched by default, on every
  Overview view.** The seeded Overview carries `day.weather`, so "a reader who
  inserts Weather" is now **every** reader of the Overview tab: every new trip
  (existing trips keep the Overview they were seeded with), the Japan demo an
  anonymous visitor opens, and an invitee's look at a trip before accepting.
  Mitchell accepted the wider flow on 2026-09-26: *"It's ok to send a users data
  to weather"*. What is sent is unchanged — a 2-decimal point per (day, city)
  with a located stop, never for a trip with none. **Quota:** a default page
  means the `weather-daily` ceilings (`server/quota.ts`, 200 per user and 5,000
  global a day, charged only on a cache miss) now meet ordinary traffic rather
  than opt-in use; the demo and invite visitors share one bucket each
  (`demo-visitor`, `invite-visitor`), so a busy demo day could exhaust its bucket
  and read "Monthly averages" or "Weather unavailable" until the next window.
  The disclosure is still owed and still Mitchell's wording; it now describes
  the default, not an opt-in.
