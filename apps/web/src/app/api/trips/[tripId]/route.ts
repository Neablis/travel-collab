import { TripDetail } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // A DELETED trip is NOT a 404: it returns 200 with status:"deleted" so the UI
  // can offer a restore instead of a dead end. Only a genuinely unknown id 404s
  // — `requireTripAccess` encodes exactly that, and also serves the effective
  // member list (log owner + accepted invites), which is what makes an invited
  // traveler show up in the trip's Travelers row (M11 link 3).
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  // Contract-honest response: validate against the schema before returning.
  return Response.json({ trip: TripDetail.parse(access.detail) });
}
