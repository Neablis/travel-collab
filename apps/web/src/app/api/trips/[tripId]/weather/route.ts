import { TripWeather } from "@tc/contracts";
import { inviteTokenOf, requireTripAccess } from "@/server/access/trip-access";
import { pgCacheStore } from "@/server/external/cache";
import { getClimate, getForecast, type Forecast } from "@/server/external/weather";
import { buildTripWeather } from "@/server/external/weather/tripWeather";
import { consumeQuota, weatherQuota } from "@/server/quota";

// The trip's weather (ADR-052 decision 3). Its own route for `globals`' reason:
// only a notebook that shows weather pays for it, and the client asks only when
// a widget on the page declares `needs: ["weather"]`.
//
// **The same guard as `globals`**, deliberately: anyone who may read the trip
// may read its weather, and anyone who may not must not learn where it goes.
// The client sends only the trip id; the points come from the trip, rounded
// before they leave (decision 6).
//
// **Never a 5xx for a source that did not answer.** A point whose source is
// down, refused by our quota, or slower than the budget is `unavailable` in a
// 200 — the widget then says so quietly, or shows typical in its place — so
// the page's one request is not the thing that fails.

// Decision 8: calls not STARTED within this budget are not made, so with a 4 s
// ceiling per call the route answers well inside a serverless timeout.
const START_BUDGET_MS = 5000;

// `getForecast()` throws without `EXTERNAL_DATA_CONTACT`, as `getGeocoder()`
// does without its key. Here that is one source down, not the route: the
// forecast is `unavailable` and the reader gets typical, labelled. `null`
// rather than a port that always rejects, because a rejecting port was CHARGED
// to the reader's weather quota on every load, until the normals were refused
// too (M14 PART 3 review, finding 3).
function forecastOrNull(): Forecast | null {
  try {
    return getForecast();
  } catch (error) {
    console.error(`[external] ${error instanceof Error ? error.message : String(error)}; forecasts are unavailable`);
    return null;
  }
}

/** Answers `{ weather }` (a `TripWeatherResponse`) for a trip the caller may read; 401/403/404 as `globals` does. */
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true, inviteToken: inviteTokenOf(request) });
  if ("error" in access) return access.error;

  const started = Date.now();
  const weather = await buildTripWeather(access.detail, {
    forecast: forecastOrNull(),
    climate: getClimate(),
    store: pgCacheStore(),
    // Per actor: a demo or invite visitor is `demo-visitor` / `invite-visitor`,
    // one shared bucket each, which is the conservative direction.
    charge: async () => (await consumeQuota(weatherQuota(), access.userId)).allowed,
    now: new Date(started),
    outOfTime: () => Date.now() - started > START_BUDGET_MS,
  });
  return Response.json({ weather: TripWeather.parse(weather) });
}
