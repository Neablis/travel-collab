### KI-2026-10-24-k — the today weather point is fetched, and charged to `weather-daily`, on every page with weather, not only on Today — RESOLVED

- **Severity:** cleanup. A small, bounded quota cost; nothing a reader sees.
- **Area:** `apps/web/src/server/external/weather/tripWeather.ts` (`todayPointOf`, about line 92,
  and `buildTripWeather` adding it to `planned`, about lines 184-205); the weather route
  `apps/web/src/app/api/trips/[tripId]/weather/route.ts`; `apps/web/src/components/pages/useExternalInputs.ts:57`
  (the client query key `tripKeys.weather(tripId)`); `apps/web/src/server/quota.ts` (`weatherQuota`).
- **Symptom / What happens:** since M52 part 11 (PR 542), the weather route adds one point dated
  today when today is none of the trip's days. Only `day.weather` on a Today page reads it, but the
  route cannot tell which page asked (`fetchTripWeather` sends only the trip id), so every page
  holding a weather widget fetches it. Its normals key is always already a job (it copies the
  nearest trip point); its forecast key is extra only when no trip date is inside the forecast
  horizon (the trip starts more than about 11 days out, or ended more than a day ago). Then it
  costs **at most one MET forecast call per trip per MET `Expires` window** (fallback one hour,
  `met-norway.ts`), against our own `weather-daily` quota (200 per user, 5,000 global per day). The
  cache is keyed by rounded point, so the call is shared across pages and users.
- **Why not fixed here:** PR 542's review round 2 weighed it and recorded rather than fixed it: the
  fix is 4 to 5 files plus tests and a second client cache entry per trip, to save one shared MET
  call per hour on an out-of-horizon trip. Fix direction: a Today page asks with `?today=1`, the
  route passes it to `buildTripWeather`, which adds the today point only then; and the client
  query key splits by it (`tripKeys.weather(tripId, { today })`), or an Overview's cached answer
  (no today point) is served to the Today page opened next.
- **Cross-reference:** M52 decision 10 (amended 2026-10-24); `docs/contracts/CHANGELOG.md`,
  2026-10-24, "The weather route answers today off the trip's dates"; ADR-052 (MET's limits).
- **First noted:** 2026-10-24, review of PR 542, rounds 1 and 2.
- **Resolved:** 2026-10-24, KI sweep, by the entry's fix direction. `buildTripWeather` takes
  `{ today }` and adds `todayPointOf`'s point only then; the route sets it from `?today=1`;
  `fetchTripWeather(tripId, { today })` sends it and `tripKeys.weather(tripId, { today })` caches
  the two answers apart (`trip:<id>:weather:today`, under the same prefix); `useExternalInputs`
  takes `{ today }` and `PageEditor` passes `context.dateScope === "today"`. Contracts CHANGELOG
  entry of the same date. Proof, each seen red first: `tripWeather.test.ts`, a non-Today request
  for a trip with no day in the horizon (`expected [ Array(3) ] to deeply equal [ Array(2) ]`
  before; after, two points, the forecast port not called, one charge of 2);
  `useExternalInputs.test.tsx`, an Overview then a Today page (`expected [ null ] to deeply equal
  [ null, '1' ]`: the Today page was served the Overview's cached answer); and
  `route.int.test.ts`, a trip three weeks out answering two dates without the flag or with
  `?today=0` and three with `?today=1`, red both with the flag ignored as true and as false.
