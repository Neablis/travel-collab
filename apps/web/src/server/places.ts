import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { SavedDayVisibility } from "@tc/contracts";
import { WorldPlaceMatch, type PlaceMatch, type PlaceSearchResponse } from "@/lib/cities";
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
 * follow the library's in the vendor's order, in the room the library leaves,
 * and `worldLimited` says when the world was asked and gave no answer.
 */
export async function searchPlaces(q: string, world: WorldSearch | null = null): Promise<PlaceSearchResponse> {
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
  if (world === null || library.length >= SEARCH_LIMIT) return { places: library };
  const found = await worldPlaces(q, library, world);
  if (found === null) return { places: library, worldLimited: true };
  return { places: [...library, ...found].slice(0, SEARCH_LIMIT) };
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
 * (`notInLibrary`), and with any the library holds under exactly that name
 * offered as the library's (`heldByLibrary`). Empty for a query too short or
 * too long to send.
 *
 * `null` when the world was asked and gave nothing to serve, so the library
 * still answers and the caller can say why the world is missing
 * (KI-2026-10-30-b). `readThrough` answers `null` exactly then: the quota
 * refused, the key is in a back-off, or the call failed or timed out, each
 * with no earlier answer held. A held answer served stale is an answer.
 */
async function worldPlaces(q: string, library: LibraryMatch[], world: WorldSearch): Promise<PlaceMatch[] | null> {
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
  if (cached === null) return null;
  const rest = notInLibrary(cached.value, library);
  const { unclaimed, claimers } = claim(rest, await heldByLibrary(rest, library));
  return [...claimers, ...unclaimed];
}

/**
 * The library's own places among `world` rows that `library` does not already
 * hold, looked up by the rows' exact names (KI-2026-10-30-c).
 *
 * `library` is the prefix index's answer, and the vendor also matches a word
 * inside a name: `york` finds the vendor's "New York" and not the library's.
 * Without this the library's New York passes as an unlabelled world row, and
 * picking it commits a world id for a place the library holds, while typing
 * `new york` gives the library's row: one place in two shapes.
 *
 * A city is looked up with `cities && ARRAY[...]`, the containment the GIN
 * index on `saved_days.cities` serves, so it stays cheap per keystroke. Exact
 * and case-sensitive like that index (KI-2026-10-05-d is the folding). A
 * country is matched by name AND code from the memoised aggregate, the
 * `notInLibrary` rule. Counted, and filtered, as `searchCities` and
 * `publishedCountries` count: published, live, unmoderated days.
 *
 * A failed lookup leaves the world rows as they are, so the library's answer
 * is never taken down by it.
 */
async function heldByLibrary(world: WorldPlaceMatch[], library: LibraryMatch[]): Promise<LibraryMatch[]> {
  const offered = new Set(library.map((p) => labelOf(p).toLowerCase()));
  const names = [...new Set(world.map((p) => p.name))].filter((name) => !offered.has(name.toLowerCase()));
  if (names.length === 0) return [];
  try {
    const wanted = sql`${sql.param(names)}::text[]`;
    const [rows, countries] = await Promise.all([
      db.execute<{ city: string; days: number }>(sql`
        select city, count(*)::int as days
        from ${savedDays}, unnest(${savedDays.cities}) as city
        where ${savedDays.visibility} = ${SavedDayVisibility.enum.public}
          and ${savedDays.deletedAt} is null
          and ${savedDays.moderatedAt} is null
          and ${savedDays.cities} && ${wanted}
          and city = any(${wanted})
        group by city
      `),
      publishedCountriesMemoised(),
    ]);
    const cities = [...rows.rows].map((row): LibraryMatch => {
      const days = Number(row.days);
      return { kind: "city", city: String(row.city), days, hasPlaybooks: days > 0 };
    });
    const named = new Set(world.map((p) => `${p.name.toLowerCase()}|${p.countryCode ?? ""}`));
    const held = countries.flatMap(({ countryCode, days }): LibraryMatch[] => {
      const name = countryName(countryCode) ?? countryCode;
      return named.has(`${name.toLowerCase()}|${countryCode}`) && !offered.has(name.toLowerCase())
        ? [{ kind: "country", countryCode, name, days, hasPlaybooks: days > 0 }]
        : [];
    });
    return [...held, ...cities];
  } catch (error: unknown) {
    console.warn(`[places] library lookup of world names: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
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
 *
 * Both guesses can miss, giving a duplicate or a hidden namesake, never a
 * wrong commit. When the vendor ranks a different namesake first (Cambridge,
 * MA over the library's Cambridge, UK), that one is hidden and the library's
 * place comes back as an unlabelled world row. And a world city with a
 * library country's name and code (Luxembourg, Singapore, Monaco) spends the
 * country's claim when ranked first, so the country itself then passes as a
 * world row beside the library's. A library place the vendor matched
 * mid-name is not in `library` at all; `heldByLibrary` finds it afterwards
 * and it claims its row by this same rule (KI-2026-10-30-c).
 */
function notInLibrary(world: WorldPlaceMatch[], library: LibraryMatch[]): WorldPlaceMatch[] {
  return claim(world, library).unclaimed;
}

/**
 * `notInLibrary`'s rule, also answering which of `places` claimed a row, in
 * the order of the rows they claimed: the vendor's.
 */
function claim(world: WorldPlaceMatch[], places: LibraryMatch[]): { unclaimed: WorldPlaceMatch[]; claimers: LibraryMatch[] } {
  const keyOf = (name: string, countryCode?: string) => `${name.toLowerCase()}|${countryCode ?? ""}`;
  const open = new Map(places.map((p) => [p.kind === "country" ? keyOf(p.name, p.countryCode) : keyOf(p.city), p]));
  const claimers: LibraryMatch[] = [];
  // Taking a key spends it: each place claims one row.
  const take = (key: string): boolean => {
    const place = open.get(key);
    if (place === undefined) return false;
    open.delete(key);
    claimers.push(place);
    return true;
  };
  const unclaimed = world.filter((p) => !take(keyOf(p.name, p.countryCode)) && !take(keyOf(p.name)));
  return { unclaimed, claimers };
}
