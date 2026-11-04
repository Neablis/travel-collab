import { TripDetail } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { getTripDetailAt } from "@/server/history";
import { listGuests } from "@/server/access/guests";
import { overlayMembers } from "@/server/access/overlay";
import { redactDetailFor } from "@/server/access/bookingRedaction";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; seq: string }> },
) {
  const { tripId, seq } = await params;
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true });
  if ("error" in access) return access.error;
  const at = await getTripDetailAt(tripId, Number(seq));
  if (at === null) return Response.json({ error: "not-found" }, { status: 404 });
  // The members overlay applies to a replayed detail too: the point-in-time
  // read replays the PLAN, not who is on the trip (membership is CRUD and has
  // no seq to replay to — ADR-026). Guests are today's, for the same reason:
  // a guest is who is coming, not a fact about the plan (guests spec P2).
  // The replay reads the raw log, so it is redacted for the caller's role here:
  // `access.detail` was, but only the live read.
  const guests = await listGuests(tripId);
  const replay = redactDetailFor(access.role, overlayMembers(at, access.detail.members, guests));
  return Response.json({ trip: TripDetail.parse(replay) });
}
