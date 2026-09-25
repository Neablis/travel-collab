import { auth } from "@/server/auth";
import { withDeprecatedDiscoverAlias } from "@/server/playbookWireAliases";
import {
  BudgetBand,
  LengthBand,
  DiscoverResponse,
  DiscoverScope,
  DiscoverSort,
  RatingFloor,
} from "@/lib/playbooks";
import { discoverDays } from "@/server/playbooks";

export const runtime = "nodejs";

// Discover's day search (M11b link 5). The endpoint that "fell between PR2 and
// PR3": PR2's task list did not include it and PR3 was scoped UI-only, so
// nothing served Discover. `published_at` and the `cities` GIN index were
// already in place for it; this is the containment query they were shipped for.
//
// Signed-in only, like every other surface in this milestone. The exit gate's
// wording is "findable by another SIGNED-IN account" — publishing puts a day in
// the invited population's library, not on the open internet, and M11a's gate
// is what bounds that population. `access/saved-day-access.ts` makes the same
// call for the same reason.
//
// **Every parameter is parsed, and an unparseable one falls back rather than
// 400s.** A search box's query string is the most reachable untrusted input in
// the product — it is in the URL, and people share URLs. An unknown `?sort=` is
// not a client bug to report, it is a stale link or a link from the future;
// answering it with the default sort shows results, and answering it with a
// 400 shows a broken page. (`highest-rated` was the example here until M12 made
// it a real sort — the promise this comment recorded, kept.) The one thing that must not
// happen is an unrecognised value reaching a query, which the enum parse is
// what prevents.
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "unauthenticated" }, { status: 401 });
  }
  const params = new URL(request.url).searchParams;

  // Repeated `?city=` rather than one comma-joined value: a city name may
  // contain a comma and splitting on one would invent a city called " Japan".
  const cities = [...new Set(params.getAll("city").map((c) => c.trim()).filter((c) => c !== ""))];
  // Repeated `?country=` beside it (M12 link 7), as ISO alpha-2 codes —
  // uppercased, because the column stores them uppercase and containment is
  // exact. A value that is not two letters is DROPPED rather than 400'd, the
  // fallback rule above: a stale or hand-typed `?country=Japan` stops narrowing
  // by country, and the page still shows results.
  const countries = [
    ...new Set(
      params
        .getAll("country")
        .map((c) => c.trim().toUpperCase())
        .filter((c) => /^[A-Z]{2}$/.test(c)),
    ),
  ];

  const result = await discoverDays({
    cities,
    countries,
    scope: DiscoverScope.catch("everyone").parse(params.get("scope")),
    sort: DiscoverSort.catch("most-added").parse(params.get("sort")),
    budget: BudgetBand.catch("any").parse(params.get("budget")),
    // `.catch("any")` for the reason every parameter here falls back rather
    // than 400ing: an unrecognised or stale `?length=` stops narrowing instead
    // of breaking the page.
    length: LengthBand.catch("any").parse(params.get("length")),
    rating: RatingFloor.catch("any").parse(params.get("rating")),
    readerId: session.user.id,
  });
  return Response.json(withDeprecatedDiscoverAlias(DiscoverResponse.parse(result)));
}
