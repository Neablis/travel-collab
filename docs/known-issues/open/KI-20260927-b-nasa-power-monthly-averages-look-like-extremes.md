### KI-2026-09-27-b — the weather block's "<Month> average" figures look like monthly extremes, not average daily highs and lows

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
- **Not confirmed:** egress to `power.larc.nasa.gov` is blocked from a cloud session, so
  the raw response and POWER's parameter definitions were not read. This is a strong
  suspicion from the numbers, not a verified root cause.
- **To confirm (from a laptop):** request the endpoint for 34.97, 135.77 with
  `parameters=T2M,T2M_MAX,T2M_MIN` and compare against the POWER parameter dictionary. If
  climatology `T2M_MAX`/`T2M_MIN` are extremes, find the parameter that means "mean daily
  maximum/minimum" and switch `PARAMETERS`. Record the real response as
  `fixtures/power-climatology.json`, which today "is written to that belief, not
  recorded" (the adapter's comment).
- **Blocks:** M14's weather walk box (left open on this).
