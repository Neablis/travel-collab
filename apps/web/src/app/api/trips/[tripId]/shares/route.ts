import { TripShare } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { createShare, listShares } from "@/server/access/shares";

// `editor`, not `owner` — deliberately a different line from invites
// (ADR-027). An invite grants participation and is the owner's call; a pinned
// share grants a read of one frozen point in history and nothing else, which
// is within what a planning participant already does. A viewer cannot create
// one: they would be handing out access they were themselves given.
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  return Response.json({ shares: (await listShares(tripId)).map((s) => TripShare.parse(s)) });
}

export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") {
    return Response.json({ error: "This trip has been deleted." }, { status: 400 });
  }
  const result = await createShare(tripId, access.userId);
  if (!result.ok) return Response.json({ error: result.error.message }, { status: 404 });
  return Response.json({ share: TripShare.parse(result.value) }, { status: 201 });
}
