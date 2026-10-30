import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { SavedDayVisibility } from "@tc/contracts";
import { WorldPlaceMatch, type PlaceMatch } from "@/lib/cities";
import { countryName } from "@/lib/place";
import { searchCities } from "./cities";
import { db } from "./db/client";
import { savedDays } from "./db/schema";
import { pgCacheStore, readThrough, type CacheStore } from "./external/cache";
import { geocoderConfigured, getGeocoder, type PlaceSuggestion } from "./geocoding";
import { consumeQuota, worldPlaceSearchQuota } from "./quota";

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

// The per-process memo in front of the countries aggregate, mirroring
// `cities.ts`'s memo (KI-2026-09-14-d) for the same reason: the place
// typeahead re-asks on every keystroke, and the aggregate scans every
// published day's `countries` array. The window is the same 30s, so the two
// halves of one list go stale together, and the invalidation bound is the
// same too: `forgetCountrySearches` is called alongside every
// `forgetCitySearches` call, so the instance that took a publish, unpublish,
// moderation or re-seed answers the next search fresh. Another serverless
// instance, or a write from the import script, is seen within the window —
// a day count up to that stale, never a day that was never public. A single
// key, because the aggregate takes no query argument: the name filtering
// happens in JS, in `searchPlaces`, after the memo.
/** The countries memo's window, matching `MEMO_TTL_MS` in `cities.ts`. */
const MEMO_TTL_MS = 30_000;
let memo: { answer: Promise<{ countryCode: string; days: number }[]>; expires: number } | undefined;

/**
 * Drop the memoised countries aggregate. Call alongside `forgetCitySearches`
 * after a write that can change which published, undeleted, unmoderated days
 * exist — the countries half of the place index moves with the city half.
 */
export function forgetCountrySearches(): void {
  memo = undefined;
}

/** The aggregate through the memo: one scan per window, not one per keystroke. */
async function publishedCountriesMemoised(): Promise<{ countryCode: string; days: number }[]> {
  const now = Date.now();
  if (memo !== undefined && memo.expires > now) return copied(memo.answer);
  const answer = publishedCountries();
  const entry = { answer, expires: now + MEMO_TTL_MS };
  memo = entry;
  // A failure is not an answer: drop it so the next keystroke asks again rather
  // than replaying the error for the rest of the window. Only if the entry is
  // still this one — a `forgetCountrySearches` in between already removed it.
  answer.catch(() => {
    if (memo === entry) memo = undefined;
  });
  return copied(answer);
}

/** Each caller gets its own rows, so one that sorts or edits them cannot rewrite the memo. */
function copied(
  answer: Promise<{ countryCode: string; days: number }[]>,
): Promise<{ countryCode: string; days: number }[]> {
  return answer.then((rows) => rows.map((row) => ({ ...row })));
}

/** A row the library answers, as opposed to the vendor's `world` rows. */
type LibraryMatch = Exclude<PlaceMatch, { kind: "world" }>;

/** The name a searcher types towards and the sort ties on, whichever kind the place is. */
function labelOf(place: LibraryMatch): string {
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
 *
 * Given `world` (a signed-in reader, `worldSearchFor`), the vendor's places
 * follow the library's in the vendor's order, in the room the library leaves.
 */
export async function searchPlaces(q: string, world: WorldSearch | null = null): Promise<PlaceMatch[]> {
  const needle = q.toLowerCase();
  const [cities, countries] = await Promise.all([searchCities(q), publishedCountriesMemoised()]);

  const places: LibraryMatch[] = [
    ...cities.map((c): LibraryMatch => ({ kind: "city", city: c.city, days: c.days, hasPlaybooks: c.days > 0 })),
    ...countries.flatMap(({ countryCode, days }): LibraryMatch[] => {
      const name = countryName(countryCode) ?? countryCode;
      return name.toLowerCase().startsWith(needle)
        ? [{ kind: "country", countryCode, name, days, hasPlaybooks: days > 0 }]
        : [];
    }),
  ];

  const exact = (p: LibraryMatch) => (labelOf(p).toLowerCase() === needle ? 0 : 1);
  const library = places
    .sort((a, b) => {
      const byExact = exact(a) - exact(b);
      if (byExact !== 0) return byExact;
      if (a.days !== b.days) return b.days - a.days;
      if (a.kind !== b.kind) return a.kind === "country" ? -1 : 1;
      const [la, lb] = [labelOf(a), labelOf(b)];
      return la < lb ? -1 : la > lb ? 1 : 0;
    })
    .slice(0, SEARCH_LIMIT);
  // A full list has no room for the world, so it is not asked, or charged.
  if (world === null || library.length >= SEARCH_LIMIT) return library;
  return [...library, ...(await worldPlaces(q, library, world))].slice(0, SEARCH_LIMIT);
}

// The world half of place search (M56 D3, ADR-084 §7), for a signed-in reader
// only. Each normalised query is one `external_data_cache` row through
// `readThrough`, which charges the account's quota on a miss and on nothing
// else. Place names do not move, so a row is kept a month.
const WORLD_CACHE_MS = 30 * 24 * 60 * 60 * 1000;
// Typeahead: a slow vendor must not hold the library's answer for long.
const WORLD_TIMEOUT_MS = 2_500;
// Under three letters a prefix names too many places to be worth a call; a
// query longer than any place name is not a search and would make a long key.
const WORLD_MIN_QUERY = 3;
const WORLD_MAX_QUERY = 80;
const WORLD_LIMIT = 5;
const WorldPlaces = z.array(WorldPlaceMatch);

/** What the world branch is given: the vendor call, the account's charge, and the cache. */
export interface WorldSearch {
  autocomplete: (q: string) => Promise<PlaceSuggestion[]>;
  /** One call charged to the reader's own `worldPlaceSearchQuota`; `false` is a refusal. */
  charge: () => Promise<boolean>;
  store: CacheStore;
  now: Date;
}

/** The world branch for signed-in `readerId`, or `null` when no vendor is configured. */
export function worldSearchFor(readerId: string): WorldSearch | null {
  if (!geocoderConfigured()) return null;
  const geocoder = getGeocoder();
  const autocomplete = geocoder.autocomplete?.bind(geocoder);
  if (autocomplete === undefined) return null;
  return {
    autocomplete: (q) => autocomplete(q, { limit: WORLD_LIMIT }),
    charge: async () => (await consumeQuota(worldPlaceSearchQuota(), readerId)).allowed,
    store: pgCacheStore(),
    now: new Date(),
  };
}

/**
 * Vendor places for `q`, less any the library already offers
 * (`notInLibrary`). Empty when the vendor fails or the quota refuses, so the
 * library still answers.
 */
async function worldPlaces(q: string, library: LibraryMatch[], world: WorldSearch): Promise<WorldPlaceMatch[]> {
  const query = q.trim().replace(/\s+/g, " ");
  if (query.length < WORLD_MIN_QUERY || query.length > WORLD_MAX_QUERY) return [];
  const cached = await readThrough({
    // Hashed, because `readThrough` logs the key on a failed call and the table
    // keeps it: what a searcher typed belongs in neither.
    key: `locationiq:autocomplete:${createHash("sha256").update(query.toLowerCase()).digest("hex")}`,
    schema: WorldPlaces,
    store: world.store,
    now: world.now,
    charge: world.charge,
    timeoutMs: WORLD_TIMEOUT_MS,
    call: async () => ({
      kind: "fresh",
      // Checked row by row here, because `readThrough` hands a fresh value back
      // unparsed: one row the vendor left without a name or a coordinate would
      // otherwise fail the route's parse and take the library's answer with it.
      value: (await world.autocomplete(query)).flatMap((s): WorldPlaceMatch[] => {
        const row = WorldPlaceMatch.safeParse({ kind: "world", ...s, hasPlaybooks: false });
        return row.success ? [row.data] : [];
      }),
      expiresAt: new Date(world.now.getTime() + WORLD_CACHE_MS),
      lastModified: null,
      sourceUpdatedAt: null,
    }),
  }).catch((error: unknown) => {
    // `readThrough` throws only for the cache table itself.
    console.warn(`[places] world search: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  return notInLibrary(cached?.value ?? [], library);
}

/**
 * `world` less the rows that are the library's own places, each of which the
 * library already offers, labelled as having playbooks.
 *
 * Each library place hides ONE world row, never every row with its name: a
 * library Paris is not Paris, Texas, and Portland, Oregon is not Portland,
 * Maine. A country is matched by name and code, so the country Georgia does
 * not hide the US state. A city row knows no country, so the vendor's
 * top-ranked namesake is taken to be it and the rest, each with its own
 * region line, stay.
 */
function notInLibrary(world: WorldPlaceMatch[], library: LibraryMatch[]): WorldPlaceMatch[] {
  const keyOf = (name: string, countryCode?: string) => `${name.toLowerCase()}|${countryCode ?? ""}`;
  const unclaimed = new Set(library.map((p) => (p.kind === "country" ? keyOf(p.name, p.countryCode) : keyOf(p.city))));
  // `delete` answers whether the key was there, and spends it: the claim is used once.
  return world.filter((p) => !unclaimed.delete(keyOf(p.name, p.countryCode)) && !unclaimed.delete(keyOf(p.name)));
}
