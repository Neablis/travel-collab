import { requireTripAccess } from "@/server/access/trip-access";
import { coverSearch } from "@/server/coverRoutes";
import { getCoverPhotos } from "@/server/external/unsplash";

// The cover picker's search (M37 D2), for a trip's editor. The only kind of
// route that spends the Unsplash quota on a search, and only when a person
// typed one; `coverSearch` holds the rules a playbook day's search shares.

/** Answers `{ results }` (a `CoverSearchResponse`): one page of candidates for `?q=`, `?page=` from 1. */
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") {
    return Response.json({ error: "This trip has been deleted." }, { status: 400 });
  }
  return coverSearch(request, access.userId, getCoverPhotos());
}
