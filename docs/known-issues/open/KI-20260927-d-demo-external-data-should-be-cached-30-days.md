### KI-2026-09-27-d — external data the demo shows should be cached 30 days or more, so demo traffic never drives API calls

- **Severity:** cost / reliability, before launch traffic. Nothing is broken today.
- **Asked by Mitchell, 2026-09-27** (Vercel comment on #257's preview, on `/demo`'s *Before
  you go* weather): *"File as a KI: Lets make sure to cache for 30d+ any external API calls
  like to weather or plugs/currency widget ONLY when they appear in the demo so we dont
  waste api calls if we get 100m visitors on the site"*.
- **What happens today (checked 2026-09-27):**
  - **Weather is the only external call.** The plugs and currency facts in *Know before you
    go* come from a static table (`packages/pages/src/macros/primitives/countryFacts.ts`);
    nothing is fetched.
  - The weather cache is **per rounded point, not per visitor**
    (`apps/web/src/server/external/cache.ts`, ADR-052 decision 2). Every reader of the demo
    shares its rows, so visitor count does not multiply calls.
  - The TTLs are the source's own:
    - MET forecasts follow MET's `Expires` header, with an hour when it is missing
      (`met-norway.ts:35`, `:115`).
    - NASA POWER normals keep 30 days (`nasa-power.ts`, `TTL_MS`).
  - So the demo's cost is about **one MET call per demo point per MET expiry**, roughly
    hourly, and only while the demo trip's dates are inside MET's ~9-day horizon. The demo
    runs Oct 7–20, 2026, so it enters the horizon about Sep 28, 2026. NASA's 30 days
    already meets the ask.
- **What is asked:** for the **demo trip only** (`isDemoTripId`), hold external data for 30
  days or more instead of the source's TTL. The demo is a showcase, so a forecast a few days
  stale is acceptable there, where it would not be on a real trip.
- **Options:**
  1. In the weather route, when `isDemoTripId(tripId)`, serve any cached row regardless of
     `expiresAt` if it is younger than 30 days, and refresh only after that. This is the
     smallest change. Keep the "updated <time>" as-of honest, so the block still says how
     old the forecast is.
  2. Precompute the demo's weather into the demo fixture, so the demo makes no live calls
     at all. This has zero API cost, but the "forecast" days then go stale, and it would
     need a credit line kept in sync by hand.
  3. Keep the source TTL but cap demo refreshes, for example one per point per day.
- **Watch:** MET's terms ask callers to honour `Expires`
  (`docs/guidelines/external-data-manual-check.md`, ADR-052 decision 8). Serving an old
  cached row is fine. Calling *more* often than `Expires` allows is what the terms forbid,
  and option 1 only ever calls *less*.
- **Also any future external widget:** when one lands, its demo appearance should get the
  same treatment. Worth a line in ADR-052 when this is fixed.
