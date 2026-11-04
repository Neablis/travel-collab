import { PageShare } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { createPageShare, listPageShares } from "@/server/access/pageShares";

// `editor`, as a pinned share (ADR-027, ADR-088 §1): a viewer or suggester
// cannot hand out a way in they were themselves given. They see the link's
// chip from the page itself, not from here.
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  return Response.json({ shares: (await listPageShares(tripId, pageId)).map((s) => PageShare.parse(s)) });
}

export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string; pageId: string }> }) {
  const { tripId, pageId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") {
    return Response.json({ error: "This trip has been deleted." }, { status: 400 });
  }
  const result = await createPageShare(tripId, pageId, access.userId);
  if (!result.ok) {
    // 422: the page exists but is one of the seeded notebooks that can't be public.
    const status = result.error.code === "invalid" ? 422 : 404;
    return Response.json({ error: result.error.message }, { status });
  }
  return Response.json({ share: PageShare.parse(result.value) }, { status: 201 });
}
