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
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const q = new URL(request.url).searchParams.get("q")?.trim();
  // Before any query: an empty box is not a search for everything. Same
  // short-circuit, same shape as geocode's `{ results: [] }`.
  if (!q) return Response.json({ cities: [] });
  return Response.json({ cities: await searchCities(q) });
}
