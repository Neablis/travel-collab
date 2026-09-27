### KI-2026-09-27-b — the weather block's "<Month> average" figures are monthly extremes, not average daily highs and lows — RESOLVED

- **Severity:** correctness, user-visible. Every day beyond the forecast horizon (most
  of a trip planned months out) shows these numbers as what to pack for.
- **Area:** `apps/web/src/server/external/weather/nasa-power.ts` reads `T2M_MAX` and
  `T2M_MIN` from POWER's `/api/temporal/climatology/point` as `highC` / `lowC`
  (`parseClimatology`, lines 63-64). The file's own header marks the response semantics
  **TO VERIFY**, because no session has reached `power.larc.nasa.gov`.
- **Symptom / What happens:** walked on #256's preview on 2026-09-27, with stops in Kyoto
  (34.97, 135.77 and 34.99, 135.78). `/api/trips/<id>/weather` returned:
  - August: high 33.66, low 15.44
  - October: high 28.72, low 4.37
  - November: high 23.33, low -0.88
  
  Kyoto's usual August night is about 24-25 °C and its October low about 14 °C. An August
  "average low" of 15.4 °C is the coldest night of the month, not a typical one. The
  pattern fits every month: the high runs hot and the low runs very cold.
- **CONFIRMED 2026-09-27.** Mitchell fetched
  `…/climatology/point?parameters=T2M,T2M_MAX,T2M_MIN&community=AG&longitude=135.77&latitude=34.97`
  from a laptop (API v2.10.0, period January 2001 - December 2020):
  - `T2M` (the mean): AUG 25.69, OCT 16.01, NOV 10.24, ANN 13.73.
  - `T2M_MAX`: AUG 33.66, JUL 34.09. **ANN 34.09 = July's value**, the maximum of the
    months, not their mean.
  - `T2M_MIN`: AUG 15.44, JAN -6.38. **ANN -6.38 = January's value**, the minimum.

  So in the climatology product, `T2M_MAX` and `T2M_MIN` are each month's **extremes**. The
  block shows August in Kyoto as "34° / 15°" where the mean is 25.7 °C. The adapter's
  belief (item 2 of its TO VERIFY header) was wrong about the meaning of these two
  parameters, though right about the response shape, the fill value and the period.
- **Still open: which parameter gives mean daily max/min.** Candidates, both asked of
  Mitchell to fetch: `T2M_MAX_AVG`/`T2M_MIN_AVG` (a direct rename), or `T2M_RANGE`
  (mean daily range, so high = `T2M` + range/2 and low = `T2M` − range/2).
- **Originally proposed (superseded by the above):** request the endpoint for 34.97, 135.77 with
  `parameters=T2M,T2M_MAX,T2M_MIN` and compare against the POWER parameter dictionary. If
  climatology `T2M_MAX`/`T2M_MIN` are extremes, find the parameter that means "mean daily
  maximum/minimum" and switch `PARAMETERS`. Record the real response as
  `fixtures/power-climatology.json`, which today "is written to that belief, not
  recorded" (the adapter's comment).
- **Blocks:** M14's weather walk box (left open on this).

- **Resolved 2026-09-27.** `nasa-power.ts` now asks for `T2M,T2M_RANGE,PRECTOTCORR` and
  reads a typical day as `T2M` ± `T2M_RANGE` / 2. `T2M_RANGE` is a mean: its `ANN`, 8.25,
  is the mean of the twelve months. `T2M_MAX_AVG` / `T2M_MIN_AVG` were also fetched and
  rejected: their `ANN` of 32.66 is above every month, so they are the per-year extremes
  averaged. Kyoto's August now reads about 29.4° / 22.0°, where it read 34° / 15°. The
  cache key is now `power:normals2` (`tripWeather.ts`), so the extremes already cached for
  up to 30 days are stranded instead of served.
  - **Proof:** `adapters.test.ts` › *reads a typical day, not the month's extremes*, on a
    fixture carrying POWER's real Kyoto `T2M` / `T2M_RANGE`. It was seen red under
    `pnpm redfirst` (`lowC` computed as mean − range: FAIL), then green.
  - **Checks run:** weather unit tests 22/22, `tsc` on web, and eslint on the changed files.
  - **Not yet recorded:** the fixture's `PRECTOTCORR` values are not from a real response.
    A precipitation check on the next preview walk closes that.
