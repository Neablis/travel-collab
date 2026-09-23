import { sql } from "drizzle-orm";
import { SavedDayVisibility } from "@tc/contracts";
import type { PlaceMatch } from "@/lib/cities";
import { countryName } from "@/lib/place";
import { searchCities } from "./cities";
import { db } from "./db/client";
import { savedDays } from "./db/schema";

// The place index behind `GET /api/places?q=` (M12 link 7): the city index
// `searchCities` already answers, plus countries, in one labelled list.
//
// **Country NAMES are not in the database** — only ISO alpha-2 codes are, and
// the code→name mapping is `Intl.DisplayNames`, which runs here and not in SQL.
// So `ILIKE 'Japan%'` has nothing to match. The milestone's recommended way
// out, taken: select every distinct code with its published-day count (at most
// ~250 rows, in practice a handful), name each in JS, prefix-filter in JS.
// Storing the name was rejected there — it is locale-dependent, and a stored
// English label goes stale the day anyone wants another language.

/** How many places one query may return — the same chip row `SEARCH_LIMIT` in `cities.ts` sizes. */
const SEARCH_LIMIT = 12;

/**
 * Every country with at least one published day, and how many DAYS touch it.
 *
 * Days, not city-hits, and not stop-hits — `searchCities`' rule. It holds
 * because `countries` is written DISTINCT per day (`countriesOfStops`
 * collapses repeats, and both writers call it), so `unnest` yields one row per
 * day per country and `count(*)` counts days: a Mexico City → Puebla → Mexico
 * City day is one Mexican day. `places/route.int.test.ts` fails if a multi-city
 * day double-counts, which is how that dependence on the writer is held.
 *
 * The same filters as `searchCities` — public, not deleted — plus
 * `moderated_at is null` (D5: a moderated day leaves place search). The city
 * half gains that filter with the moderation unit; this half is new, so it is
 * born with it.
 */
async function publishedCountries(): Promise<{ countryCode: string; days: number }[]> {
  const rows = await db.execute<{ code: string; days: number }>(sql`
    select code, count(*)::int as days
    from ${savedDays}, unnest(${savedDays.countries}) as code
    where ${savedDays.visibility} = ${SavedDayVisibility.enum.public}
      and ${savedDays.deletedAt} is null
      and ${savedDays.moderatedAt} is null
    group by code
  `);
  // Asserted at the boundary, as `searchCities` does: `db.execute`'s type
  // parameter is a claim, not a check.
  return [...rows.rows].map((row) => ({ countryCode: String(row.code), days: Number(row.days) }));
}

/** The name a searcher types towards and the sort ties on, whichever kind the place is. */
function labelOf(place: PlaceMatch): string {
  return place.kind === "city" ? place.city : place.name;
}

/**
 * Cities and countries whose name starts with `q`, each with how many
 * published days touch it, labelled by kind.
 *
 * **Matched on the NAME only, never on the code.** Two letters is the most
 * common state a search box is in, and a code match would answer `De` with
 * Germany (DE) and `Es` with Spain (ES) — results whose names do not begin
 * with what was typed, which is exactly what makes a prefix search feel
 * broken. Nobody searches a travel library for "MX".
 *
 * Prefix and case-insensitive, like `searchCities`'s `ILIKE`; no accent
 * folding, also like it, so the two halves of one list agree on what matches.
 *
 * Ordering, deterministic and in this priority:
 *   1. an EXACT name match first, whichever kind — typing all of `Mexico`
 *      means the country, typing all of `Mexico City` means the city;
 *   2. then more days first — the busiest place for those letters, which on
 *      its own puts a country ahead of its own cities (a country's days are a
 *      superset of each of its cities');
 *   3. a tie goes to the country, the wider place;
 *   4. then UTF-16 code-unit order on the label, never `localeCompare` —
 *      `siblingCities` in `playbooks.ts` records why.
 */
export async function searchPlaces(q: string): Promise<PlaceMatch[]> {
  const needle = q.toLowerCase();
  const [cities, countries] = await Promise.all([searchCities(q), publishedCountries()]);

  const places: PlaceMatch[] = [
    ...cities.map((c): PlaceMatch => ({ kind: "city", city: c.city, days: c.days })),
    ...countries.flatMap(({ countryCode, days }): PlaceMatch[] => {
      const name = countryName(countryCode) ?? countryCode;
      return name.toLowerCase().startsWith(needle) ? [{ kind: "country", countryCode, name, days }] : [];
    }),
  ];

  const exact = (p: PlaceMatch) => (labelOf(p).toLowerCase() === needle ? 0 : 1);
  return places
    .sort((a, b) => {
      const byExact = exact(a) - exact(b);
      if (byExact !== 0) return byExact;
      if (a.days !== b.days) return b.days - a.days;
      if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
      const [la, lb] = [labelOf(a), labelOf(b)];
      return la < lb ? -1 : la > lb ? 1 : 0;
    })
    .slice(0, SEARCH_LIMIT);
}
