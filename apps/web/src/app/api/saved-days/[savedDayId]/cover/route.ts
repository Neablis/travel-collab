import { TripCoverResponse } from "@tc/contracts";
import { requireSavedDayAuthor } from "@/server/access/saved-day-access";
import { coverPick } from "@/server/coverRoutes";
import { getCoverPhotos } from "@/server/external/unsplash";
import { publicLibraryReader } from "@/server/publicLibraryLimit";
import { clearSavedDayCover, getSavedDayCover, setSavedDayCover } from "@/server/savedDayCovers";
import { readableSavedDay } from "@/server/savedDays";

// A playbook day's cover photo (M37 part 5): Community CRUD on
// `saved_day_covers`, `trips/[tripId]/cover`'s shape with the author in the
// editor's place. A cover changes how the day looks in Discover and to every
// reader of its page, so only the person who wrote the day sets or clears it.
//
// A published day's page and every list that shows its card are cached for a
// day (ADR-063), so a write clears them, the way a publish does: a reader sees
// the new cover on their next page, not tomorrow. `setSavedDayCover` and
// `clearSavedDayCover` decide that from the day after the write.

/** Answers `{ cover }` for a day the caller may open: their own, or a published one. Asks Unsplash nothing. */
export async function GET(request: Request, { params }: { params: Promise<{ savedDayId: string }> }) {
  const { savedDayId } = await params;
  const reader = await publicLibraryReader(request);
  if ("refused" in reader) return reader.refused;
  if ((await readableSavedDay(savedDayId, reader.readerId)) === null) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }
  return Response.json(TripCoverResponse.parse({ cover: await getSavedDayCover(savedDayId) }));
}

/** Makes the picked candidate the day's cover and answers `{ cover }`, with one download ping per pick. */
export async function PUT(request: Request, { params }: { params: Promise<{ savedDayId: string }> }) {
  const { savedDayId } = await params;
  const author = await requireSavedDayAuthor(savedDayId);
  if ("error" in author) return author.error;
  return coverPick(request, author.readerId, getCoverPhotos(), (candidate) =>
    setSavedDayCover(savedDayId, candidate, author.readerId),
  );
}

/** Removes the day's cover; answers `{ cover: null }`. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ savedDayId: string }> }) {
  const { savedDayId } = await params;
  const author = await requireSavedDayAuthor(savedDayId);
  if ("error" in author) return author.error;
  await clearSavedDayCover(savedDayId);
  return Response.json(TripCoverResponse.parse({ cover: null }));
}
