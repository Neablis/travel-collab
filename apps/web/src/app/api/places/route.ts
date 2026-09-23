import { PlaceSearchResponse } from "@/lib/cities";
import { auth } from "@/server/auth";
import { searchPlaces } from "@/server/places";

export const runtime = "nodejs";

// Place search (M12 link 7): `/api/cities`' successor, answering with cities
// AND countries, each labelled by `kind` so `Mexic` can offer the country
// Mexico and the city Mexico City as two things a click can tell apart.
//
// Every convention is `/api/cities`' own, on purpose — signed-in only, `?q=`
// trimmed, an empty box short-circuited to an empty list before any work, no
// quota (this reads a column, not a paid vendor) — so moving the search box
// from one endpoint to the other changes what it offers and nothing about how
// it behaves. The response is parsed on the way out, the same boundary
// `api/playbooks` draws, because `PlaceMatch` is a discriminated union and a
// row that fits neither arm must fail here rather than in a component.
/** `GET /api/places?q=` — cities and countries starting with `q`, with published-day counts. */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim();
  if (!q) return Response.json({ places: [] } satisfies PlaceSearchResponse);
  return Response.json(PlaceSearchResponse.parse({ places: await searchPlaces(q) }));
}
