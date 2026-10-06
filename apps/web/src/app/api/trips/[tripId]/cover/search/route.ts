import { CoverSearchResponse } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { getCoverPhotos, UpstreamError } from "@/server/external/unsplash";
import { consumeQuota, quotaRefusal, unsplashSearchQuota } from "@/server/quota";

// The cover picker's search (M37 D2). The only route that spends the Unsplash
// quota on a search, and only when a person typed one: an empty query answers
// nothing without asking anyone, as `/api/geocode` does.

// Unsplash's search answers at most 50 pages for a sensible query; a page
// beyond what anyone scrolls is refused here rather than spent there.
const MAX_PAGE = 50;
const MAX_QUERY = 100;

/** Answers `{ results }` (a `CoverSearchResponse`): one page of candidates for `?q=`, `?page=` from 1. */
export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") {
    return Response.json({ error: "This trip has been deleted." }, { status: 400 });
  }
  const search = new URL(request.url).searchParams;
  const q = search.get("q")?.trim() ?? "";
  const page = Number(search.get("page") ?? "1");
  if (q.length > MAX_QUERY || !Number.isInteger(page) || page < 1 || page > MAX_PAGE) {
    return Response.json({ error: `q is at most ${MAX_QUERY} characters; page is 1 to ${MAX_PAGE}` }, { status: 400 });
  }
  const photos = getCoverPhotos();
  if (photos === null) return Response.json({ error: "covers-unavailable" }, { status: 503 });
  if (!q) return Response.json(CoverSearchResponse.parse({ results: [] }));
  const quota = await consumeQuota(unsplashSearchQuota(), access.userId);
  if (!quota.allowed) return quotaRefusal(quota);
  try {
    return Response.json(CoverSearchResponse.parse({ results: await photos.search(q, page) }));
  } catch (error) {
    if (!(error instanceof UpstreamError)) throw error;
    console.error(`[covers] ${error.message}`);
    return Response.json({ error: "covers-upstream" }, { status: 502 });
  }
}
