import { PlaceSearchResponse } from "@/lib/cities";
import { searchPlaces, worldSearchFor } from "@/server/places";
import { publicLibraryReader } from "@/server/publicLibraryLimit";

export const runtime = "nodejs";

// Place search (M12 link 7): `/api/cities`' successor, answering with cities
// AND countries, each labelled by `kind` so `Mexic` can offer the country
// Mexico and the city Mexico City as two things a click can tell apart.
//
// Every convention is `/api/cities`' own, on purpose — `?q=` trimmed, an
// empty box short-circuited to an empty list before any work — so moving the
// search box from one endpoint to the other changes what it offers and nothing
// about how it behaves. The response is parsed on the way out, the same boundary
// `api/playbooks` draws, because `PlaceMatch` is a discriminated union and a
// row that fits no arm must fail here rather than in a component.
//
// Open to a reader with no account (ADR-061): it is Discover's search box, and
// it only ever counts published, unmoderated days. That reader is charged per
// IP like the rest of the public library (`publicLibraryLimit.ts`) and gets
// the library only. A signed-in reader also gets the world (M56 D3), LocationIQ
// places after the library's, charged to their account's own quota on a cache
// miss (`worldSearchFor`).
/** `GET /api/places?q=` — places starting with `q`: the library's with published-day counts, then the world's when signed in. */
export async function GET(request: Request) {
  const reader = await publicLibraryReader(request);
  if ("refused" in reader) return reader.refused;
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ places: [] } satisfies PlaceSearchResponse);
  const world = reader.readerId === null ? null : worldSearchFor(reader.readerId);
  return Response.json(PlaceSearchResponse.parse({ places: await searchPlaces(q, world) }));
}
