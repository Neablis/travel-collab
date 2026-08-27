import { TripInvite } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { revokeInvite } from "@/server/access/invites";

// Revoke. Owner-only, and idempotent: revoking an already-revoked invite is a
// 200, not a 404, so a double-click cannot produce a scary error.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; inviteId: string }> },
) {
  const { tripId, inviteId } = await params;
  const access = await requireTripAccess(tripId, "owner");
  if ("error" in access) return access.error;
  const result = await revokeInvite(tripId, inviteId);
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 404 });
  }
  return Response.json({ invite: TripInvite.parse(result.value) });
}
