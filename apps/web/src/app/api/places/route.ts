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
// the library only. A signed-in reader who asks with `world=1` also gets the
// world (M56 D3), LocationIQ places after the library's, charged to their
// account's own quota on a cache miss (`worldSearchFor`). Opt-in (Mitchell,
// 2026-10-30): New trip's Where page asks; Discover does not, because a world
// place has no published days to filter Discover by, and its typing would
// spend the quota New trip depends on.
/** `GET /api/places?q=[&world=1]` — places starting with `q`: the library's with published-day counts, then, if asked and signed in, the world's. */
export async function GET(request: Request) {
  const reader = await publicLibraryReader(request);
  if ("refused" in reader) return reader.refused;
  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim();
  if (!q) return Response.json({ places: [] } satisfies PlaceSearchResponse);
  const asked = params.get("world") === "1";
  const world = asked && reader.readerId !== null ? worldSearchFor(reader.readerId) : null;
  return Response.json(PlaceSearchResponse.parse({ places: await searchPlaces(q, world) }));
}
