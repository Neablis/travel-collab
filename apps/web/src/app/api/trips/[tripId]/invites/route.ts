import { CreateInviteInput, TripInvite } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { createInvite } from "@/server/access/invites";

// Owner-only, by the same argument the AccessPolicy table uses for DeleteTrip:
// an editor plans the trip, an owner decides who is on it.
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "owner");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") {
    return Response.json({ error: "This trip has been deleted." }, { status: 400 });
  }
  const body = CreateInviteInput.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid-invite" }, { status: 400 });
  const invite = await createInvite(tripId, access.userId, body.data);
  return Response.json({ invite: TripInvite.parse(invite) }, { status: 201 });
}
