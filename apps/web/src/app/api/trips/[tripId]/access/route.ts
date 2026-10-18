import { requireTripAccess } from "@/server/access/trip-access";
import { accessRevForRead } from "@/server/access/members";
import { tripAccessView } from "@/server/tripViews";

// The People section's one read: who is on this trip, what am I, and (owner
// only) which links are outstanding.
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  // First, before anything that reads the members: `requireTripAccess` reads
  // them, and `listInvites` reads the invites. A rev read first is never newer
  // than the list it is served with, so a client that takes it as its baseline
  // re-reads on any write the list missed (KI-2026-10-05-g, spec W22). Read
  // before the auth check, so a refused caller pays one primary-key read. The
  // rev is served only to a caller who passes the check.
  const accessRev = await accessRevForRead(tripId);
  const access = await requireTripAccess(tripId, "viewer", { allowDemo: true });
  if ("error" in access) return access.error;
  return Response.json(await tripAccessView(tripId, access, accessRev));
}
