import { TripCoverResponse } from "@tc/contracts";
import { requireTripAccess } from "@/server/access/trip-access";
import { coverPick, tripDeleted } from "@/server/coverRoutes";
import { getCoverPhotos } from "@/server/external/unsplash";
import { clearTripCover, getTripCover, setTripCover } from "@/server/tripCovers";

// A trip's cover photo (M37). Not a planning command: a cover is a decoration
// on the trip, kept in its own table and never in the event log (D1), so these
// handlers write it directly, the way the Access routes write memberships.
//
// Setting or clearing one is an editor's call, the line shares draw: it changes
// how the trip looks to everyone on it, which is within what a planning
// participant already does. A viewer and a suggester are refused by the same
// rank comparison every write route uses.

/** Answers `{ cover }` (a `TripCoverResponse`) for a trip the caller may read. Asks Unsplash nothing. */
export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "viewer");
  if ("error" in access) return access.error;
  return Response.json(TripCoverResponse.parse({ cover: await getTripCover(tripId) }));
}

/**
 * Makes the picked candidate the trip's cover and answers `{ cover }`, with
 * one download ping per pick, after the response (`coverPick`).
 */
export async function PUT(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") return tripDeleted();
  return coverPick(request, access.userId, getCoverPhotos(), (candidate) =>
    setTripCover(tripId, candidate, access.userId),
  );
}

/** Removes the trip's cover; answers `{ cover: null }`. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const access = await requireTripAccess(tripId, "editor");
  if ("error" in access) return access.error;
  if (access.detail.status === "deleted") return tripDeleted();
  await clearTripCover(tripId);
  return Response.json(TripCoverResponse.parse({ cover: null }));
}
