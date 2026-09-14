import { auth } from "@/server/auth";
import { searchCities } from "@/server/cities";

export const runtime = "nodejs";

// City search (M11b link 2). Same query-param shape as `/api/geocode` —
// `?q=`, trimmed, with the empty query short-circuited before any work — so the
// two search boxes in this product behave identically at the one moment a user
// notices a difference: the keystroke that empties the field.
//
// Deliberately NOT geocode's other half: no quota. `/api/geocode` is charged
// because it spends the operator's LocationIQ allowance on every call; this one
// reads a column of this database, and a rate limit whose only justification
// was symmetry with a paid vendor would be a control that does nothing.
//
// The four states PR3's UI has to render come out of this endpoint as three
// distinguishable answers, and nothing else is needed for the fourth:
//   * results     — 200, `cities` non-empty
//   * no matches  — 200, `cities: []` (a real answer, not a failure)
//   * loading     — the client's own, before this resolves
//   * failure     — a non-2xx or a dropped connection, which the client retries
// The only route in this app that sets a cache header, and it earns it twice
// over: the answer is a pure function of `?q=`, and computing it is an
// `unnest` + aggregate over every published saved day (`server/cities.ts`)
// with no index a prefix match can use. A typeahead re-asking the same
// question is the expensive case, and this is the cheap half of fixing it —
// `CitySearch` holds the other half in memory for the same five minutes
// (`DEDUPE.SEARCH`), which is what makes a repeat within one session free.
//
// **`private` even though the body has no per-user content.** It is behind
// `auth()`, and a shared cache holding a response served under someone's
// session cookie is a habit worth not forming — the day this endpoint gains a
// "days you saved" count, `public` would be the leak and nobody would be
// re-reading this line. The per-user reasoning it does NOT need: the rows are
// published days, identical for every reader, so a browser cache surviving a
// sign-out hands the next account nothing it could not have asked for itself.
const CACHE_HEADERS = { "Cache-Control": "private, max-age=300" };

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim();
  // Before any query: an empty box is not a search for everything. Same
  // short-circuit, same shape as geocode's `{ results: [] }`.
  if (!q) return Response.json({ cities: [] }, { headers: CACHE_HEADERS });
  return Response.json({ cities: await searchCities(q) }, { headers: CACHE_HEADERS });
}
