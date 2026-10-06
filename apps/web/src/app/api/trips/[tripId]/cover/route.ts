import { SetCoverBody, TripCoverResponse } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { getCoverPhotos } from "@/server/external/unsplash";
import { consumeQuota, quotaRefusal, unsplashSearchQuota } from "@/server/quota";
import { readBody } from "@/server/readBody";
import { clearTripCover, getTripCover, setTripCover } from "@/server/tripCovers";

// A trip's cover photo (M37). Not a planning command: a cover is a decoration
// on the trip, kept in its own table and never in the event log (D1), so these
// handlers write it directly, the way the Access routes write memberships.
//
// Setting or clearing one is an editor's call, the line shares draw: it changes
// how the trip looks to everyone on it, which is within what a planning
// participant already does. A viewer and a suggester are refused by the same
// rank comparison every write route uses.

// What the UI reads to say covers are not set up on this deployment.
const UNAVAILABLE = () => Response.json({ error: "covers-unavailable" }, { status: 503 });
const DELETED = () => Response.json({ error: "This trip has been deleted." }, { status: 400 });

/** Answers `{ cover }` (a `TripCoverResponse`) for a trip the caller may read. Asks Unsplash nothing. */
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  return Response.json(TripCoverResponse.parse({ cover: await getTripCover(tripId) }));
}

/**
 * Makes the picked candidate the trip's cover and answers `{ cover }`. The
 * candidate is re-checked against the cover source, charged to the Unsplash
 * quota, stored, and then reported to Unsplash as a download — once per pick,
 * a re-pick of the same photo included (guideline 2).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") return DELETED();
  const body = await readBody(request, SetCoverBody, "candidate is required");
  if ("error" in body) return body.error;
  const photos = getCoverPhotos();
  if (photos === null) return UNAVAILABLE();
  const { candidate } = body.data;
  // The pick comes from the browser and its links are then shown to everyone
  // on the trip, so it must be one the source could have returned: images on
  // its CDN, credits on unsplash.com, the ping on its API.
  if (!photos.owns(candidate)) return Response.json({ error: "not-a-cover-candidate" }, { status: 400 });
  const quota = await consumeQuota(unsplashSearchQuota(), access.userId);
  if (!quota.allowed) return quotaRefusal(quota);
  const cover = await setTripCover(tripId, candidate, access.userId);
  // After the write, and not fatal to it: the cover is chosen whether or not
  // Unsplash heard about it, and failing the pick over a lost ping would make
  // a person pick again — which would be a second use, and a second ping.
  try {
    await photos.trackDownload(candidate.downloadLocation);
  } catch (error) {
    console.error(`[covers] download ping failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return Response.json(TripCoverResponse.parse({ cover }));
}

/** Removes the trip's cover; answers `{ cover: null }`. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") return DELETED();
  await clearTripCover(tripId);
  return Response.json(TripCoverResponse.parse({ cover: null }));
}
