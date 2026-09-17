import { z } from "zod";
import { CityMatch } from "@/lib/cities";
import { searchCities } from "@/server/cities";
import { route } from "@/server/public-api/route";

// `?q=` in, list out — already the most API-shaped thing in the app.
//
// **No quota beyond the wrapper's.** `/api/geocode` is charged because it spends
// the operator's LocationIQ allowance per call; this reads a column of this
// database, and `geocode` is deliberately not in `v1` for exactly that reason.

/**
 * A cursor this endpoint minted, or `null`.
 *
 * A cursor we did not mint costs the caller a first page rather than a 400 —
 * the same bargain `listTripSummariesPage` makes, and for the same reason: the
 * string is opaque by contract, so punishing a caller for its contents would
 * be punishing them for not reading it.
 */
function decodeCursor(after: string | null): { days: number; city: string } | null {
  if (after === null) return null;
  const sep = after.indexOf("|");
  if (sep === -1) return null;
  // Only what `cursorOf` can actually produce: a canonical non-negative
  // integer and a non-empty city. `Number.isInteger` alone let `-1|Rome` and
  // `3|` through, and both then filter a page rather than taking the first-page
  // fallback this function's own comment promises.
  const daysText = after.slice(0, sep);
  const city = after.slice(sep + 1);
  if (!/^(0|[1-9]\d*)$/.test(daysText) || city === "") return null;
  const days = Number(daysText);
  if (!Number.isSafeInteger(days)) return null;
  return { days, city };
}

export const { GET } = route({
  GET: {
    scope: "trips:read",
    query: z.object({ q: z.string().trim().min(1).max(200) }),
    // **The cursor carries the WHOLE sort key, because the sort has two parts.**
    // `searchCities` orders `days desc, city asc`. A cursor of just the city
    // name compared with `city > after` describes a different order than the
    // one the rows are in, so page two both repeats every alphabetically-later
    // city from page one and permanently skips the alphabetically-earlier ones
    // further down the days ranking.
    collection: {
      item: CityMatch,
      cursorOf: (city: z.infer<typeof CityMatch>) => `${city.days}|${city.city}`,
    },
    handle: async ({ query, page }) => {
      const matches = await searchCities((query as { q: string }).q);
      const after = decodeCursor(page.after);
      if (after === null) return matches.slice(0, page.limit);
      return matches
        .filter((c) => c.days < after.days || (c.days === after.days && c.city > after.city))
        .slice(0, page.limit);
    },
  },
});
