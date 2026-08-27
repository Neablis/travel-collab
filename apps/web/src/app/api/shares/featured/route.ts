import { SharedTripView } from "@tc/contracts";
import { readFeaturedShare } from "@/server/access/shares";

// A static segment, so Next.js routes `/api/shares/featured` here and every
// other `/api/shares/:token` to the sibling dynamic route. `featured` is
// therefore a reserved token — harmless, since real tokens are 43-character
// base64url and can never collide with it — and it means `/s/featured` is
// served by the same page component as any other share, fetching the same
// shape from a different path.
//
// Which trip this is, is deployment configuration (`DEMO_SHARE_TOKEN`), not a
// product feature: M12 Community owns discovery and the trust & safety surface
// that would decide it, and is explicitly out of M11's scope.
export async function GET() {
  const result = await readFeaturedShare();
  if (!result.ok) {
    return Response.json({ error: result.error.message }, { status: 404 });
  }
  return Response.json({ trip: SharedTripView.parse(result.value) });
}
