import { PlaceSearchResponse } from "@/lib/cities";
import { searchPlaces } from "@/server/places";
import { publicLibraryReader } from "@/server/publicLibraryLimit";

export const runtime = "nodejs";

// Place search (M12 link 7): `/api/cities`' successor, answering with cities
// AND countries, each labelled by `kind` so `Mexic` can offer the country
// Mexico and the city Mexico City as two things a click can tell apart.
//
// Every convention is `/api/cities`' own, on purpose — `?q=` trimmed, an
// empty box short-circuited to an empty list before any work, no vendor quota
// (this reads a column, not a paid vendor) — so moving the search box from one
// endpoint to the other changes what it offers and nothing about how it
// behaves. The response is parsed on the way out, the same boundary
// `api/playbooks` draws, because `PlaceMatch` is a discriminated union and a
// row that fits neither arm must fail here rather than in a component.
//
// Open to a reader with no account (ADR-061): it is Discover's search box, and
// it only ever counts published, unmoderated days. That reader is charged per
// IP like the rest of the public library (`publicLibraryLimit.ts`); a
// signed-in one is not.
/** `GET /api/places?q=` — cities and countries starting with `q`, with published-day counts. */
export async function GET(request: Request) {
  const reader = await publicLibraryReader(request);
  if ("refused" in reader) return reader.refused;
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ places: [] } satisfies PlaceSearchResponse);
  return Response.json(PlaceSearchResponse.parse({ places: await searchPlaces(q) }));
}
