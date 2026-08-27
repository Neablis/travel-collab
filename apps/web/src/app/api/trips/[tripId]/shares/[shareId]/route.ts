import { TripShare } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { revokeShare } from "@/server/access/shares";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; shareId: string }> },
) {
  const { tripId, shareId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  const result = await revokeShare(tripId, shareId);
  if (!result.ok) return Response.json({ error: result.error.message }, { status: 404 });
  return Response.json({ share: TripShare.parse(result.value) });
}
