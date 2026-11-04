import { PageShare } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { revokePageShare } from "@/server/access/pageShares";

/**
 * Revokes one share link; editor only. Idempotent: a repeat answers 200 with the
 * share as first revoked. An unknown share, or one on another page, is 404.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; pageId: string; shareId: string }> },
) {
  const { tripId, pageId, shareId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  const result = await revokePageShare(tripId, pageId, shareId);
  if (!result.ok) return Response.json({ error: result.error.message }, { status: 404 });
  return Response.json({ share: PageShare.parse(result.value) });
}
