import { sql } from "drizzle-orm";
import { SavedDayVisibility } from "@tc/contracts";
import type { CityMatch } from "@/lib/cities";
import { db } from "./db/client";
import { savedDays } from "./db/schema";

// The city index behind `GET /api/cities?q=` (M11b link 2).
//
// **Only published days count.** The index is a public artefact: a city that
// appears in it tells everyone somebody has a day there, and a day count is a
// number people will read as "how much is here". A private day contributing to
// either would leak its author's plans through an aggregate — the same class of
// mistake as a search result that 403s but confirms the id exists — so the
// filter is on the query and not on the caller.
//
// **Read off `saved_days.cities`, never `saved_days.stops`.** `stops` is jsonb
// precisely because a saved day is a value that is never queried into
// (ADR-029); `cities` is the `text[]` snapshot that exists so this question has
// somewhere to be asked. Link 1's whole argument is that deriving cities per
// query would be querying into the value the ADR says is a value.

/** How many cities one query may return — a chip row, not a directory. */
const SEARCH_LIMIT = 12;

/**
 * Cities whose name starts with `q`, with how many published days touch each.
 *
 * `unnest` + `GROUP BY` rather than the GIN index's containment operator, and
 * the difference is worth naming because the two look interchangeable: `cities
 * && ARRAY['Kyoto']` answers *"which DAYS contain this exact city"*, which is
 * what Discover's day query (link 5) asks on every keystroke and what the index
 * was shipped for. This asks the other question — *"which city NAMES begin with
 * these letters"* — and no array index can serve a prefix match. What keeps it
 * cheap is that the thing being scanned is a snapshot column of short strings,
 * not the plan documents.
 *
 * Prefix rather than substring: "kyo" should find Kyoto, but "oto" finding
 * Kyoto is how a city picker starts returning results nobody was typing
 * towards. `ILIKE` because a person typing into a search box is not holding
 * shift, and `\` / `%` / `_` are escaped so a query of "100%" is a search for a
 * city called that rather than a match-everything wildcard.
 *
 * Ordered by day count then name: the busiest city for those letters first, and
 * a stable tiebreak so the same query does not return two different orders.
 */
export async function searchCities(q: string): Promise<CityMatch[]> {
  const prefix = `${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const rows = await db.execute<{ city: string; days: number }>(sql`
    select city, count(*)::int as days
    from ${savedDays}, unnest(${savedDays.cities}) as city
    where ${savedDays.visibility} = ${SavedDayVisibility.enum.public}
      -- A day its owner deleted is out of the index too. This is one of the
      -- reads the soft delete has to be filtered out of, and the schema's
      -- deleted_at note lists every one of them: a city chip counting a day
      -- nobody can open would send a searcher to a Discover page holding one
      -- fewer day than the chip promised.
      and ${savedDays.deletedAt} is null
      and city ilike ${prefix}
    group by city
    order by days desc, city asc
    limit ${SEARCH_LIMIT}
  `);
  // `db.execute` hands back whatever the driver produced; `count(*)::int` is
  // already a number and `city` is already text, but neither is checked by a
  // type parameter — so the shape is asserted at this boundary rather than
  // trusted downstream (the KI-71 lesson, one table smaller).
  return [...rows.rows].map((row) => ({ city: String(row.city), days: Number(row.days) }));
}
