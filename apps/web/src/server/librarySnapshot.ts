import type { DescribedTag } from "@tc/domain";
import type { CityMatch } from "@/lib/cities";
import {
  DISCOVER_PAGE_SIZE,
  inBudgetBand,
  LENGTH_BAND_RANGE,
  RATING_FLOOR_MIN,
  type DiscoverDay,
  type DiscoverResponse,
  type DiscoverSort,
} from "@/lib/playbooks";
import { cityKey } from "@/lib/playbookUrls";
import type { DiscoverQuery } from "./playbooks";

// **The whole public library as one value, and the lists a stranger reads
// worked out of it** (ADR-063, amended 2026-11-22). Discover and the place,
// tag, length and author pages were each cached per URL: one entry per
// search, cursor and `?page=N`. A crawler that walks those URLs finds a new
// key almost every time, and every new key was a database read, which woke
// Neon from its sleep a few times a minute through the night. One entry
// holding every published day answers all of them, so a URL nobody has asked
// for before is a filter over memory, not a query.
//
// What lives here is the part that needs no database: the predicates and the
// ranking of `playbooks.ts`, spelled over that value, and the steps after the
// read that both spellings share (`keeps`, `siblingCities`,
// `summarizeDiscover`). `playbooks.int.snapshot.int.test.ts` holds each list
// read this way to the same list read by SQL. The SQL stays: a signed-in
// reader's Discover, the JSON API and the public API still read live.

/**
 * How many ranked rows the database is asked for before the application-side
 * filters run.
 *
 * A day's total cost is a sum over its priced stops (`savedDayFacts`), so it
 * cannot be a SQL predicate without querying into the jsonb ADR-029 says is a
 * value. It is therefore applied to a bounded window of already-ranked
 * candidates, and the response says so (`truncated`) rather than reporting a
 * filtered count that silently means "of the first 200".
 */
export const CANDIDATE_LIMIT = 200;

/** How many sibling / "busy right now" chips a row carries. Matches `cities.ts`. */
const SIBLING_LIMIT = 12;

/**
 * One published day as the snapshot holds it: its card, and the columns
 * `matchPredicate`, `matchedCount` and `orderBy` read, taken off the row
 * rather than off the card so the two spellings rank on the same values.
 */
export type LibraryEntry = {
  id: string;
  /**
   * The Discover card read with no cities asked for and no reader, or null for
   * a row this server cannot read. Null rows are kept: the SQL counts and
   * ranks them before dropping them, and so the candidate window and the
   * match count agree.
   */
  card: DiscoverDay | null;
  ownerId: string;
  /** `cities_folded`, as Postgres generates it — never refolded here. */
  citiesFolded: string[];
  countries: string[];
  /** The `day_count` column, which the length band filters on: the card's `dayCount` is floored. */
  dayCount: number;
  adds: number;
  rating: number | null;
  reviewCount: number;
  /** `saved_day_ranks.score`, or null for a day the rank job has not scored. */
  score: number | null;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds, or null. */
  publishedAt: number | null;
};

/** What the snapshot is asked for: a Discover query with no reader, as a stranger's always is. */
type SnapshotQuery = Pick<
  DiscoverQuery,
  "cities" | "countries" | "sort" | "budget" | "length" | "rating" | "tag" | "authorId"
>;

/**
 * Whether a card answers what the query asks after the read: the budget band
 * and the tag, which are both worked out from the stops.
 */
export function keeps(query: Pick<DiscoverQuery, "budget" | "tag">, day: DiscoverDay): boolean {
  const tag = query.tag ?? "any";
  return (
    inBudgetBand(query.budget, day.totalCost?.amountMinor ?? null) && (tag === "any" || day.namedTags.includes(tag))
  );
}

/**
 * Cities in the RESULT SET that the query did NOT ask for, with counts —
 * §15's sibling chips.
 *
 * **Counted here, in application code, over the same in-band days the cards are
 * drawn from — not by a `group by` over `matchPredicate`.** That was the shape
 * until 2026-09-02 and it could not carry the budget band: a day's total is a
 * sum over its priced stops (`savedDayFacts`) and ADR-029 makes `stops` a value
 * that is never queried into, so the band is applied to the candidate window
 * after the rows come back. A chip counted in SQL therefore counted the whole
 * match while the page below it showed the band — with `Under $200` on, a chip
 * read `Osaka · 3` above a page holding one card (KI-2026-08-31). Two counts of
 * two different sets, and the one on screen was the wrong one. One array now
 * feeds both, so they cannot disagree again.
 *
 * What the number means, stated because the row's shape invites a wrong reading:
 * **"days in these results that also touch this city"**, NOT "days tapping this
 * chip would add". City matching is containment (`d.cities_folded && ARRAY[...]`), so
 * adding a city WIDENS the match — tapping a chip can only ever return at least
 * this many days, never fewer. `DiscoverScreen` labels the row "Also in these
 * results" for that reason.
 *
 * Counted over every in-band candidate rather than over the 24 that fit on the
 * page — the original deliberate choice, and the one part of this the band bug
 * never touched. What bounds it now is `CANDIDATE_LIMIT`, the same window the
 * band itself runs over, and `truncated` is already the response's word for
 * "that window was full".
 *
 * With an empty query there is nothing to subtract and this is the *"busy right
 * now"* row instead — the busiest cities among the ranked candidates. One
 * derivation serves both, which is why there is no second "popular cities"
 * endpoint.
 */
export function siblingCities(days: DiscoverDay[], queryCities: string[]): CityMatch[] {
  // By `cityKey`, the rule the SQL matched on (KI-2026-10-05-d): "Osaka" and
  // "osaka" are one chip, and no chip is a spelling of a city already asked
  // for. The chip is spelled the way the first day to carry it spells it —
  // `days` is in ranked order, so that is stable for a given result.
  const asked = new Set(queryCities.map(cityKey));
  const counts = new Map<string, { city: string; days: number }>();
  for (const day of days) {
    // A `Set` of keys so a day is counted once per city even if it carries two
    // spellings of one — a chip that counted one day twice would be the same
    // class of lie this function was rewritten to stop telling.
    const seen = new Set<string>();
    for (const city of day.cities) {
      const key = cityKey(city);
      if (asked.has(key) || seen.has(key)) continue;
      seen.add(key);
      const chip = counts.get(key);
      if (chip === undefined) counts.set(key, { city, days: 1 });
      else chip.days += 1;
    }
  }
  return (
    [...counts.values()]
      // UTF-16 code-unit order on the tiebreak, not `localeCompare`: this
      // replaced an `order by days desc, city asc` whose collation came from the
      // database, so pinning it to something that does not vary with a locale
      // keeps the row identical between a developer's machine, CI and production.
      // That determinism is the whole requirement and `<`/`>` meets it exactly.
      //
      // It is NOT codepoint order, which is what this comment claimed until
      // CodeRabbit read it (PR 123). JS `<` compares code units, so an
      // astral-plane character — U+10000 and up, encoded as a surrogate pair
      // starting in D800 — sorts BEFORE U+E000-U+FFFF. `city` is free text
      // (`z.string().min(1).max(200)`), so that input is reachable rather than
      // impossible, and it is still left alone on purpose: the difference is the
      // order of at most SIBLING_LIMIT chips in one row, both orders are stable
      // on every machine, and neither is alphabetical to a reader anyway. A
      // codepoint comparator would buy a distinction nobody can perceive and
      // cost an allocating comparison plus a test to hold it in place.
      //
      // Do not reach for `localeCompare` to "fix" this. Varying with the locale
      // is the bug the sort replaced.
      .sort((a, b) => b.days - a.days || (a.city < b.city ? -1 : a.city > b.city ? 1 : 0))
      .slice(0, SIBLING_LIMIT)
  );
}

/**
 * The parts of a Discover response counted over the ranked candidate window
 * rather than the page, from that window's cards in rank order (null for a row
 * that could not be read) and the number of rows the predicates matched in all.
 * Both spellings of `discoverDays` end here, so they cannot count differently.
 */
export function summarizeDiscover(input: {
  query: Pick<DiscoverQuery, "cities" | "budget" | "tag">;
  window: readonly (DiscoverDay | null)[];
  totalCount: number;
  page: DiscoverDay[];
  sharedPlaybookCount: number;
}): DiscoverResponse {
  const { query, window, totalCount, page } = input;
  const windowFull = window.length === CANDIDATE_LIMIT;
  const candidates = window.filter((day): day is DiscoverDay => day !== null);

  // The one currency every matched day agrees on, or null. Decided over the
  // candidates rather than the page so the budget control does not appear and
  // disappear as you scroll. See `BudgetBand` for why a mixed set hides it
  // rather than comparing numbers that are not comparable.
  const currencies = new Set(candidates.map((d) => d.totalCost?.currency).filter((c): c is string => c !== undefined));
  const budgetCurrency = currencies.size === 1 ? [...currencies][0]! : null;

  const filtered = candidates.filter((day) => keeps(query, day));
  const askedAfterRead = query.budget !== "any" || (query.tag ?? "any") !== "any";
  const days = page.slice(0, DISCOVER_PAGE_SIZE);
  const nextCursor = page.length > DISCOVER_PAGE_SIZE ? days.at(-1)!.savedDayId : null;

  return {
    days,
    nextCursor,
    // `filtered`, not `candidates` and not the page: the chips describe the set
    // the cards come from, band included. See `siblingCities`.
    siblings: siblingCities(filtered, query.cities),
    budgetCurrency,
    // Unfiltered on purpose — see `sharedPlaybookCount` on the response. It answers
    // "is there a library at all", which is what decides whether the
    // leaderboard link has anything to rank, and no filter on this query may
    // change that answer.
    sharedPlaybookCount: input.sharedPlaybookCount,
    // BOTH caps, not just the candidate window: a query matching 25 to 199
    // days used to return 24 cards flagged as the complete set (CodeRabbit,
    // PR 102). Discover pages by `nextCursor` since M42; the profile day list
    // is this same function, unpaged, and says the same thing there by
    // comparing its card count against `playbooksShared`.
    truncated: windowFull || filtered.length > DISCOVER_PAGE_SIZE,
    // What the results sentence states (KI-2026-09-23-h). Inside the window
    // `filtered` IS the whole match — band and tag applied, unreadable rows
    // dropped — so it is exact and agrees with the pages to the day. Past the
    // window the SQL total is used, minus the rows this read could not parse;
    // that is exact only with no band or tag on, since neither can be a
    // predicate. With one on past the window, what is known is a floor, and it
    // says so: the window's matches, or this page's cards and one more when
    // there is a next page, whichever is more, so "10+" never heads 24 cards.
    ...(!windowFull
      ? { matchCount: filtered.length, matchCountExact: true }
      : !askedAfterRead
        ? {
            matchCount: totalCount - (window.length - candidates.length),
            matchCountExact: true,
          }
        : {
            matchCount: Math.max(filtered.length, days.length + (nextCursor === null ? 0 : 1)),
            matchCountExact: false,
          }),
  };
}

/** A matched entry and how many of the asked-for places it touches, `orderBy`'s first key. */
type Ranked = { entry: LibraryEntry; matched: number };

/**
 * How many of the asked-for places `entry` touches: `matchedCount`. Sets on
 * both sides, as `intersect` is, so two spellings of one city count once.
 */
function matchedCount(entry: LibraryEntry, cityKeys: ReadonlySet<string>, countries: ReadonlySet<string>): number {
  let n = 0;
  for (const key of new Set(entry.citiesFolded)) if (cityKeys.has(key)) n += 1;
  for (const country of new Set(entry.countries)) if (countries.has(country)) n += 1;
  return n;
}

/**
 * `matchPredicate` for a reader with no account, over an entry already known
 * to be published, not deleted and not moderated (the snapshot holds no other).
 */
function matches(
  entry: LibraryEntry,
  query: SnapshotQuery,
  cityKeys: ReadonlySet<string>,
  countries: ReadonlySet<string>,
): boolean {
  // Places are OR'd, and asking for none asks for everything.
  const placed =
    (cityKeys.size === 0 && countries.size === 0) ||
    entry.citiesFolded.some((key) => cityKeys.has(key)) ||
    entry.countries.some((country) => countries.has(country));
  if (!placed) return false;
  if ((query.authorId ?? null) !== null && entry.ownerId !== query.authorId) return false;
  if (query.length !== "any") {
    const [min, max] = LENGTH_BAND_RANGE[query.length];
    if (entry.dayCount < min || (max !== null && entry.dayCount > max)) return false;
  }
  const floor = query.rating ?? "any";
  // An unrated day is below every floor, as `null >= 4` is not true in SQL.
  return floor === "any" || (entry.rating !== null && entry.rating >= RATING_FLOOR_MIN[floor]);
}

/** `a - b` for a descending key with SQL's `nulls last`: a null sorts after every number. */
function descNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return b - a;
}

/**
 * `orderBy`'s ranking as a comparator, after the matched count: the same keys
 * in the same order, then `d.id` ascending. A uuid's lowercase text sorts as
 * Postgres sorts the uuid, byte by byte, so the string compare is that order.
 */
function compareBy(sort: DiscoverSort): (a: Ranked, b: Ranked) => number {
  const then: (a: LibraryEntry, b: LibraryEntry) => number = {
    "most-added": (a: LibraryEntry, b: LibraryEntry) => b.adds - a.adds || b.createdAt - a.createdAt,
    top: (a: LibraryEntry, b: LibraryEntry) =>
      descNullsLast(a.score, b.score) || b.adds - a.adds || b.createdAt - a.createdAt,
    "highest-rated": (a: LibraryEntry, b: LibraryEntry) =>
      descNullsLast(a.rating, b.rating) || b.reviewCount - a.reviewCount,
    "most-reviewed": (a: LibraryEntry, b: LibraryEntry) =>
      b.reviewCount - a.reviewCount || descNullsLast(a.rating, b.rating),
    newest: (a: LibraryEntry, b: LibraryEntry) => (b.publishedAt ?? b.createdAt) - (a.publishedAt ?? a.createdAt),
  }[sort];
  return (a, b) =>
    b.matched - a.matched || then(a.entry, b.entry) || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0);
}

/**
 * Every entry the query matches, ranked as `orderBy` ranks them — the whole
 * match, as `publishedDaysPage` reads it and before `CANDIDATE_LIMIT` cuts
 * Discover's window.
 */
function ranked(entries: readonly LibraryEntry[], query: SnapshotQuery): Ranked[] {
  const cityKeys = new Set(query.cities.map(cityKey));
  const countries = new Set(query.countries ?? []);
  return entries
    .filter((entry) => matches(entry, query, cityKeys, countries))
    .map((entry) => ({
      entry,
      matched: matchedCount(entry, cityKeys, countries),
    }))
    .sort(compareBy(query.sort));
}

/**
 * An entry's card for this query: the snapshot's card with the matched cities
 * worked out for the cities asked, as `toDiscoverDay` would have done. The
 * reader has no account, so nothing is theirs.
 */
function cardFor(entry: LibraryEntry, cityKeys: ReadonlySet<string>): DiscoverDay | null {
  if (entry.card === null) return null;
  return {
    ...entry.card,
    matchedCities: entry.card.cities.filter((c) => cityKeys.has(cityKey(c))),
    isMine: false,
  };
}

/**
 * `discoverDays` for a reader with no account, over the snapshot: the same
 * page, chips, currency and counts the SQL would answer.
 *
 * One difference, on purpose: a cursor that names no day in the snapshot is
 * no cursor. The SQL answers a cursor naming a private or deleted day by that
 * day's rank, which only a hand-made URL can carry; page one is the honest
 * answer to it, and costs no read.
 */
export function discoverFromSnapshot(
  entries: readonly LibraryEntry[],
  query: SnapshotQuery,
  after: string | null,
): DiscoverResponse {
  const cityKeys = new Set(query.cities.map(cityKey));
  const order = ranked(entries, query);
  const window = order.slice(0, CANDIDATE_LIMIT).map(({ entry }) => cardFor(entry, cityKeys));

  // `discoverPage`: the rows ranked strictly after the cursor's own keys, as
  // they are now, whether or not the cursor's day matches this query.
  const cursor = after === null ? undefined : entries.find((entry) => entry.id === after);
  let rest: Ranked[] = order;
  if (cursor !== undefined) {
    const compare = compareBy(query.sort);
    const countries = new Set(query.countries ?? []);
    const at: Ranked = {
      entry: cursor,
      matched: matchedCount(cursor, cityKeys, countries),
    };
    rest = order.filter((row) => compare(row, at) > 0);
  }
  const page: DiscoverDay[] = [];
  for (const { entry } of rest) {
    const card = cardFor(entry, cityKeys);
    if (card !== null && keeps(query, card)) page.push(card);
    // One past the page, so the last page knows it is the last.
    if (page.length > DISCOVER_PAGE_SIZE) break;
  }

  return summarizeDiscover({
    query,
    window,
    totalCount: order.length,
    page,
    // The snapshot is every published, unmoderated, undeleted day, which is
    // what `publishedPlaybookCount` counts.
    sharedPlaybookCount: entries.length,
  });
}

/**
 * What a place, tag, length or author page asks of the library: the filter
 * `playbooks.ts`'s `publishedDaysPage` takes.
 */
export type PublishedDaysFilter = {
  cities?: string[];
  countries?: string[];
  authorId?: string;
  tag?: DescribedTag;
  /** Discover's length band, as its own predicate: a length page. */
  length?: DiscoverQuery["length"];
  sort?: DiscoverSort;
  /**
   * Additionally require the day to touch one of these city spellings —
   * the AND half of a country×city page, since `matchPredicate` ORs its
   * places: `countries` alone would list every day in the country, not the
   * city's days in it. The count side (`publishedCountryCityPages`, and the
   * country×city tag counts) applies the same membership test, so the two
   * cannot disagree.
   */
  citiesWithin?: string[];
};

/**
 * The query `publishedDaysPage` runs for `filter`, shared by both spellings:
 * a reader who owns nothing, published days only, top first.
 */
export function publishedDaysQuery(filter: PublishedDaysFilter): DiscoverQuery {
  return {
    cities: filter.cities ?? [],
    countries: filter.countries ?? [],
    authorId: filter.authorId ?? null,
    scope: "everyone",
    sort: filter.sort ?? "top",
    budget: "any",
    length: filter.length ?? "any",
    tag: filter.tag ?? "any",
    publishedOnly: true,
    readerId: null,
  };
}

/**
 * The steps after `publishedDaysPage`'s read, shared by both spellings: drop
 * an unreadable row, one whose description does not name the tag, and one
 * outside `citiesWithin`, then cut the page. `total` counts what is left.
 */
export function pageOfPublishedDays(
  cards: readonly (DiscoverDay | null)[],
  query: DiscoverQuery,
  citiesWithin: readonly string[] | undefined,
  page: { limit: number; offset: number },
): { days: DiscoverDay[]; total: number } {
  const within = citiesWithin === undefined ? null : new Set(citiesWithin);
  const readable = cards.filter(
    (day): day is DiscoverDay =>
      day !== null && keeps(query, day) && (within === null || day.cities.some((city) => within.has(city))),
  );
  return {
    days: readable.slice(page.offset, page.offset + page.limit),
    total: readable.length,
  };
}

/** `publishedDaysPage` over the snapshot: the same page and total the SQL would answer. */
export function publishedDaysFromSnapshot(
  entries: readonly LibraryEntry[],
  filter: PublishedDaysFilter,
  page: { limit: number; offset: number },
): { days: DiscoverDay[]; total: number } {
  const query = publishedDaysQuery(filter);
  const cityKeys = new Set(query.cities.map(cityKey));
  const cards = ranked(entries, query).map(({ entry }) => cardFor(entry, cityKeys));
  return pageOfPublishedDays(cards, query, filter.citiesWithin, page);
}
