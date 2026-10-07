import { requireSavedDayAuthor } from "@/server/access/saved-day-access";
import { coverSearch } from "@/server/coverRoutes";
import { getCoverPhotos } from "@/server/external/unsplash";

// The cover picker's search for a playbook day (M37 part 5): the trip
// picker's rules (`coverSearch`), for the day's author only — a search spends
// the Unsplash quota, and only someone who can pick may spend it.

/** Answers `{ results }` (a `CoverSearchResponse`): one page of candidates for `?q=`, `?page=` from 1. */
export async function GET(request: Request, { params }: { params: Promise<{ savedDayId: string }> }) {
  const { savedDayId } = await params;
  const author = await requireSavedDayAuthor(savedDayId);
  if ("error" in author) return author.error;
  return coverSearch(request, author.readerId, getCoverPhotos());
}
