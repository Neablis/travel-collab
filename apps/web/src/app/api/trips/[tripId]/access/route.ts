import { TripAccess } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { withProfiles } from "@/server/access/members";
import { listInvites } from "@/server/access/invites";
import { demoTripMembers } from "@/server/demoTrip";
import { isDemoTripId } from "@/lib/demoTrip";

// The Travelers panel's one read: who is on this trip, what am I, and (owner
// only) which links are outstanding.
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  // Any member may see who else is here. Only the owner sees invites, because
  // a `TripInvite` carries its token — an editor who could list them could
  // hand out access the owner never granted.
  const invites = access.role === "owner" ? await listInvites(tripId) : [];
  // `withProfiles` reads the users table to put a name and a face on each
  // member id. The demo trip's travellers are invented people (ADR-031), so
  // there is nothing to look up and — more to the point — nothing that should
  // be looked up: the demo is served without touching the database, and this
  // is the one read on its path that would otherwise have.
  const members = isDemoTripId(tripId)
    ? demoTripMembers()
    : await withProfiles(access.detail.members);
  return Response.json({
    access: TripAccess.parse({ tripId, myRole: access.role, members, invites }),
  });
}
