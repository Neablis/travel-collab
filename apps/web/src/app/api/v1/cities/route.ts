import { z } from "zod";
import { CityMatch } from "@/lib/cities";
import { searchCities } from "@/server/cities";
import { route } from "@/server/public-api/route";

// `?q=` in, list out — already the most API-shaped thing in the app.
//
// **No quota beyond the wrapper's.** `/api/geocode` is charged because it spends
// the operator's LocationIQ allowance per call; this reads a column of this
// database, and `geocode` is deliberately not in `v1` for exactly that reason.
export const { GET } = route({
  GET: {
    scope: "trips:read",
    query: z.object({ q: z.string().trim().min(1).max(200) }),
    collection: { item: CityMatch, cursorOf: (city: z.infer<typeof CityMatch>) => city.city },
    handle: async ({ query, page }) => {
      const matches = await searchCities((query as { q: string }).q);
      const after = page.after;
      return (after === null ? matches : matches.filter((c) => c.city > after)).slice(0, page.limit);
    },
  },
});
