import { TripDetail } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { getTripDetailAt } from "@/server/history";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; seq: string }> },
) {
  const { tripId, seq } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  const at = await getTripDetailAt(tripId, Number(seq));
  if (at === null) return Response.json({ error: "not-found" }, { status: 404 });
  // The members overlay applies to a replayed detail too: the point-in-time
  // read replays the PLAN, not who is on the trip (membership is CRUD and has
  // no seq to replay to — ADR-026).
  return Response.json({ trip: TripDetail.parse({ ...at, members: access.detail.members }) });
}
