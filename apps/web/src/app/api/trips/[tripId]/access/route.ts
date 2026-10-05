import { TripAccess } from "@tc/contracts";
import { inviteTokenOf, requireTripAccess } from "@/server/access/trip-access";
import { accessRevForRead, withProfiles } from "@/server/access/members";
import { listInvites } from "@/server/access/invites";
import { demoTripMembers } from "@/server/demoTrip";
import { isDemoTripId } from "@/lib/demoTrip";
import { accountCan } from "@/server/entitlements/resolver";

// The People section's one read: who is on this trip, what am I, and (owner
// only) which links are outstanding.
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // First, before anything that reads the members: `requireTripAccess` reads
  // them, and `listInvites` reads the invites. A rev read first is never newer
  // than the list it is served with, so a client that takes it as its baseline
  // re-reads on any write the list missed (KI-2026-10-05-g, spec W22). Read
  // before the auth check, so a refused caller pays one primary-key read. The
  // rev is served only to a caller who passes the check.
  const accessRev = await accessRevForRead(tripId);
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true, inviteToken: inviteTokenOf(request) });
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
    : await withProfiles(access.detail.members, access.userId);
  // **The OWNER's entitlement, not the reader's** (M20 link 6). The owner is
  // the billing subject — collaboration on a trip is paid for by whoever owns
  // it — so an editor reading this learns whether the trip they are on is
  // collaborative, not whether their own account could pay for one.
  //
  // Advisory, exactly like `myRole`: it decides whether the invite form renders
  // at all, and `POST /invites` refuses server-side regardless of what the
  // client did with it.
  //
  // The demo trip is entitled by construction. Its travellers are invented
  // people (ADR-031) and it is served without touching the database, so asking
  // Entitlements about an owner who is not an account would be both a lookup
  // that cannot succeed and the one database read this path exists to avoid.
  const owner = access.detail.members[0]?.userId ?? null;
  const collaboratorsEntitled =
    isDemoTripId(tripId) || owner === null
      ? true
      : await accountCan(owner, "trip.collaborators");
  return Response.json({
    access: TripAccess.parse({ tripId, myRole: access.role, members, invites, collaboratorsEntitled, accessRev }),
  });
}
