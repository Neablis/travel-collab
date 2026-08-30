import { auth } from "@/server/auth";
import {
  BudgetBand,
  DiscoverResponse,
  DiscoverScope,
  DiscoverSort,
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
// the product — it is in the URL, and people share URLs. `?sort=highest-rated`
// is not a client bug to report, it is a link written against §15's four sorts
// or a link from the future; answering it with the default sort shows results,
// and answering it with a 400 shows a broken page. The one thing that must not
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

  const monthRaw = Number(params.get("month"));
  const month = Number.isInteger(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? monthRaw : null;

  const result = await discoverDays({
    cities,
    scope: DiscoverScope.catch("everyone").parse(params.get("scope")),
    sort: DiscoverSort.catch("most-added").parse(params.get("sort")),
    budget: BudgetBand.catch("any").parse(params.get("budget")),
    month,
    readerId: session.user.id,
  });
  return Response.json(DiscoverResponse.parse(result));
}
