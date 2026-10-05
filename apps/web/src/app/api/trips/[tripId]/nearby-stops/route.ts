import { z } from "zod";
import { NearbyStopsResponse } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { nearbyStopsFor } from "@/server/nearbyStops";

// Nearby stops for the add-stop sheet (M34). One read of the public library,
// scoped by the trip: the trip is read only to find the day's cities, and that
// is why the route checks trip access at all (D13) — anyone who may read the
// trip may ask, and anyone who may not must not learn where it goes.
//
// Signed-in members only: no `allowDemo`, no invite token. The demo's board and
// a *Have a look first* board are both read-only, so neither ever opens the
// add-stop sheet — and the reads an invite token opens are exactly the demo's,
// by M27 D12 (`inviteTokenRoutes.test.ts` holds the two lists equal). Opening
// either here would widen what an anonymous caller can run for no reader.

// A coordinate is a finite number or absent. Not `z.coerce.number()` alone:
// it maps "" to 0, and `?lat=&lng=` would then be a point off the coast of
// Ghana rather than a malformed request (the `events` route's reason).
const Coordinate = z.string().trim().min(1).pipe(z.coerce.number().finite());

const Query = z
  .object({
    dayId: z.string().uuid().optional(),
    lat: Coordinate.pipe(z.number().min(-90).max(90)).optional(),
    lng: Coordinate.pipe(z.number().min(-180).max(180)).optional(),
  })
  // As a pair, like `Location`'s own refinement: half a point is not a point.
  .refine((q) => (q.lat === undefined) === (q.lng === undefined), { message: "lat and lng go together" });

/** `GET /api/trips/:tripId/nearby-stops?dayId=&lat=&lng=` — a `NearbyStopsResponse`; 400 on a bad query, 401/403/404 as `globals` does. */
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;

  const search = new URL(request.url).searchParams;
  const query = Query.safeParse({
    dayId: search.get("dayId") ?? undefined,
    lat: search.get("lat") ?? undefined,
    lng: search.get("lng") ?? undefined,
  });
  if (!query.success) {
    return Response.json({ error: query.error.issues[0]?.message ?? "invalid-query" }, { status: 400 });
  }
  const { dayId, lat, lng } = query.data;

  const stops = await nearbyStopsFor({
    detail: access.detail,
    dayId: dayId ?? null,
    anchor: lat !== undefined && lng !== undefined ? { lat, lng } : null,
    readerId: access.userId,
  });
  return Response.json(NearbyStopsResponse.parse({ stops }));
}
