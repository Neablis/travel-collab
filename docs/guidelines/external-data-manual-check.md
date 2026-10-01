# Walking weather against the real services

No automated test here calls MET Norway or NASA POWER, and none may (Mitchell's policy).
The e2e server sets `EXTERNAL_DATA_OFFLINE=true` (`apps/web/playwright.config.ts`), and
the unit lane throws on any `fetch` to a host other than this machine (`apps/web/vitest.setup.ts`). So the only
check against the real services is this walk, done by hand on a Vercel preview. It is
also the only way to settle what ADR-052 and the two adapters still mark **to verify**.

Walk it once before M14's weather gate box is ticked, and again whenever
`met-norway.ts` or `nasa-power.ts` changes what it sends or reads.

## Before you start

- A Vercel **preview** for the branch, with `EXTERNAL_DATA_CONTACT` set in the
  project's Preview environment: an operator's address, never a user's (ADR-052
  decision 6). Without it the forecast is off by design and step 2 cannot pass.
- `EXTERNAL_DATA_OFFLINE` must **not** be set on the preview. It is an e2e switch.
- Access to the deployment's runtime logs (the Vercel dashboard, or the Vercel MCP's
  runtime-log tool filtered to the preview).
- Today's date. The forecast horizon is about nine days from it.

## The walk

1. **Make three trips**, each with at least one stop that has a real location on a
   dated day (a geocoded place, not a bare name):
   - **Soon**: starting within the next three days, lasting four or more days.
   - **Later**: starting 30 or more days from today.
   - **Past**: ended last month.

2. **Soon trip.** Open its notebook, enter Editing, insert **Weather**, then Done.
   - The block opens as its **graphic**: a row per (day, city), the city over its day, a
     bar from the low to the high on one temperature scale, and the rain at the right.
     The low and high are printed at the bar's two ends and the rain to two decimals;
     they are numbers, not dashes.
   - Days inside the horizon draw a **solid bar** in the city's colour, with the sky in
     words after the day ("Day 2 · Light rain"). That is the forecast; today's row is one
     of them and has no column of its own.
   - Days past the horizon, if any, draw a **dashed outline** with no sky. That is the
     month's typical.
   - Select the block and set **Show as: Table**. The same rows read
     **Day · City · High · Low · Rain · Source**, and Source says **Forecast** for the
     solid rows and **Typical** for the dashed ones. Set it back to Graphic.
   - The footer is one line: **"Forecast: Norwegian Meteorological Institute, CC BY 4.0
     (updated <time>)"**, with the time on your 12-hour/24-hour setting, and the credit
     links to `https://api.met.no/doc/License`. *(Its wording changed on the #221 preview
     at Mitchell's request; `WeatherBlock.tsx`'s header comment has the reason.)*
   - Which day is "today" is the **place's** date, not the reader's (ADR-052's 2026-09-27
     amendment): a trip in a zone already past midnight draws yesterday there as typical.
   - Switch your account's units to Imperial in account settings: the block now
     reads °F and inches (ADR-052's 2026-09-24 amendment). Switch back.
   - Days 3 and later: compare one day's high and low against met.no's own page for the
     place. A high noticeably below the afternoon figure means the `complete` product's
     six-hour extremes were not read (step 6).

3. **Later trip.** Every row is a **dashed outline** (Source: **Typical** as a table). The
   footer reads **"Monthly averages: NASA POWER, <from>–<through>"**, and no MET credit is
   shown. Note the period it prints; step 5 asks about it. **Sanity-check the numbers
   against the place's known climate**: a low far below the month's usual night
   temperature is the KI-2026-09-27-b symptom (extremes read as averages).

4. **Past trip.** Every row is a **dashed outline** (Source: **Typical**), with the NASA
   credit: a day already gone reads the same as one too far out to forecast.

5. **A source failing.** In the runtime logs for the requests above, find
   `GET /api/trips/<id>/weather`. A healthy walk has no `[external]` line. To see
   the failure line once, open a trip on a preview **without** `EXTERNAL_DATA_CONTACT`
   (or ask for Production's logs after a known outage). The lines are:
   - `[external] EXTERNAL_DATA_CONTACT is not set; forecasts are unavailable` — the
     route's own, when the forecast is unconfigured;
   - `[external] <key>: <message>` — from the cache's read-through, whenever a call
     fails; `<key>` names the source and the rounded point (`met:forecast:…` or
     `power:normals2:…`);
   - `[external] MET Norway refused the request (403): …` — the adapter's own, when MET
     rejects our User-Agent or our coordinate precision.
   The reader sees typical, labelled "— no forecast right now", when only the forecast
   failed, and the quiet **weather unavailable** when both did.

6. **Settle what is still to verify.** Record each answer in ADR-052's
   *Review points* (item 6) and in the adapter's header comment, and delete the
   **TO VERIFY** there once it is settled.

   **NASA POWER** (`apps/web/src/server/external/weather/nasa-power.ts`). Call the
   endpoint once from a machine that can reach it, with the same query the adapter sends:
   `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_RANGE,PRECTOTCORR&community=AG&latitude=35.01&longitude=135.77&format=JSON`
   - **Endpoint path.** Does `/api/temporal/climatology/point` answer 200 with this
     query, or redirect or refuse it?
   - **Averaging period.** What `header.start` / `header.end` (or `header.range`)
     say. Does it match the "2001–2020" the block printed in step 3? If the header carries
     no period, the block is printing `PERIOD_IF_UNSTATED`, a belief.
   - **Response shape.** Is it `properties.parameter.<NAME>.<JAN…DEC>` with a `-999`
     `header.fill_value`, and are the units °C and mm/day? Compare with
     `fixtures/power-climatology.json`, which was written from the docs and never
     recorded from a real response. Replace it with the real response, trimmed.
   - Whether POWER publishes a request-rate figure.

   **MET Norway** (`apps/web/src/server/external/weather/met-norway.ts`). Fetch
   `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=35.01&lon=135.77` with
   a User-Agent in the adapter's form (`travel-collab/<version> +<site> <contact>`).
   - Do six-hour steps carry `data.next_6_hours.details.air_temperature_max` and
     `air_temperature_min` under those exact names? If they are absent, a day's high and
     low come from its instants alone (the old behaviour; never a wrong number, but an
     underestimate).
   - Does the response answer 200, not 203? A 203 means `complete` is deprecated, and the
     adapter logs it.

7. **Tick the box.** When steps 2 to 5 read as described and step 6's answers are
   recorded, tick M14's gate box *"Weather walked against the real MET Norway and NASA
   POWER on a preview"* with the preview URL and the date.
