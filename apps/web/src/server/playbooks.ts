import { sql, type SQL } from "drizzle-orm";
import { SavedDayVisibility } from "@tc/contracts";
import type { CityMatch } from "@/lib/cities";
import {
  DISCOVER_PREVIEW_STOPS,
  inBudgetBand,
  LENGTH_BAND_RANGE,
  RATING_FLOOR_MIN,
  type BudgetBand,
  type LengthBand,
  type DiscoverDay,
  type DiscoverResponse,
  type DiscoverScope,
  type DiscoverSort,
  type PublicAuthor,
  type RatingFloor,
} from "@/lib/playbooks";
import { savedDayFacts } from "@/lib/savedDayFacts";
import { displayNameFor } from "@/lib/displayName";
import { db } from "./db/client";
import { parseSavedDayColumns } from "./savedDayRow";

// The public library's three read surfaces (M11b links 5, 7 and 8): Discover's
// day search, the leaderboard, and a public profile.
//
// **This is the containment query link 1's column and GIN index were shipped
// for.** `server/cities.ts` answers the other half — *"which city NAMES begin
// with these letters"*, a prefix scan no array index can serve. This one asks
// *"which DAYS contain any of these cities"*, which is `cities && ARRAY[...]`
// and is exactly what `saved_days_cities` indexes. The two look interchangeable
// and are not; each names the other so a later reader does not merge them.
//
// **Read off `saved_days.cities`, never `saved_days.stops`.** `stops` is jsonb
// because a saved day is a value that is never queried into (ADR-029); every
// predicate below is on a real column, and the only thing done with `stops` is
// to parse it whole and derive the card's facts in application code — which is
// reading a value, not querying into one.

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
const CANDIDATE_LIMIT = 200;

/** How many cards one Discover page shows. */
const PAGE_LIMIT = 24;

/** How many sibling / "busy right now" chips a row carries. Matches `cities.ts`. */
const SIBLING_LIMIT = 12;

export type DiscoverQuery = {
  /** The cities asked for. Empty is a browse, not a search for nothing. */
  cities: string[];
  /**
   * The countries asked for, as uppercase ISO alpha-2 codes (M12 link 7).
   * Absent or empty adds no constraint.
   *
   * **Places are OR'd, cities and countries alike**: a day matches if it
   * touches ANY selected place — the rule cities already follow ("a day
   * matches on any city it contains"), extended rather than given a second
   * meaning. Optional so the profile and the assistant, which never ask by
   * country, need not say so.
   */
  countries?: string[];
  scope: DiscoverScope;
  sort: DiscoverSort;
  budget: BudgetBand;
  /**
   * How many days a Playbook must span (M23).
   *
   * Unlike `budget`, this one IS a SQL predicate — `day_count` is a column, so
   * it filters before the candidate window is truncated and its chip counts
   * cannot disagree with the page below them.
   */
  length: LengthBand;
  /**
   * The minimum average rating (M12 D9), a SQL predicate for `length`'s
   * reason. Optional because only Discover's own route offers it: a profile
   * and the assistant's port browse unfloored, and "absent" meaning `any` is
   * the same answer they would otherwise each have to spell.
   */
  rating?: RatingFloor;
  /**
   * Narrow to one person's days — what a public profile is.
   *
   * A parameter on this query rather than a query of its own, and that is the
   * agreement property the exit gate checks: the cards on a profile ARE
   * Discover cards, ranked and derived by the same code, so the two cannot
   * disagree about a day's cities, adds or budget. A second query shaped like
   * this one would agree only until somebody edited one of them.
   */
  authorId?: string | null;
  /**
   * Published days only, whatever the scope says.
   *
   * The public profile's rule, and it is NOT the same question the scope
   * segment asks. A profile shows what somebody has published — *"showing its
   * owner a different page than everybody else is how a profile starts
   * disagreeing with itself"* (the profile route's own comment) — and it used
   * to get that for free from `everyone` meaning "public only". Since
   * `everyone` became a superset that includes the reader's own private days
   * (2026-09-01), that freebie is gone and the rule has to be stated: without
   * this flag an author looking at their own profile saw three days where
   * everybody else saw two, which is exactly the disagreement the comment
   * warns about. Caught by the integration suite, not by review.
   */
  publishedOnly?: boolean;
  readerId: string;
};

type DiscoverRow = {
  id: string;
  owner_id: string;
  name: string;
  stops: unknown;
  cities: string[];
  visibility: string;
  author_kind: string;
  day_count: number;
  adds: number;
  rating: number | null;
  review_count: number;
  source_trip_name: string;
  created_at: unknown;
  published_at: unknown;
  matched_count: number;
};

/**
 * A timestamp column, as an ISO-8601 string.
 *
 * `db.execute` hands back whatever the DRIVER produced — unlike a Drizzle
 * `select()`, which applies the schema's `mode: "date"` and yields a `Date`.
 * The type parameter on `db.execute` is an assertion, not a check (the same
 * hole `cities.ts` names one column smaller), and the two shapes are not
 * interchangeable: `row.created_at.toISOString()` throws on a string. Both are
 * accepted here rather than one being assumed.
 */
function isoOf(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * The soft-delete filter, spelled once and pasted into every query in this file.
 *
 * A day its owner deleted is gone from Discover, from the sibling chips, from
 * the shared-day count, from the leaderboard's numbers, from a profile's counts
 * and from its "Knows" chips — because `deleted_at` means the day is not in the
 * library any more, and a surface that still counted it would be reporting a
 * day nobody can open. It leads with `and` so it drops into a predicate the
 * same way at every site; `leaderboard` is the one caller that has to supply
 * its own `where true` to receive it.
 *
 * One constant rather than seven literals: the whole risk of this column is a
 * read that forgets it, and `grep notDeleted` is how the next person checks
 * whether a query they are adding has one. Note that `d` is the alias every
 * query in this file gives `saved_days`.
 */
const notDeleted = sql`and d.deleted_at is null`;

/**
 * The moderation filter (M12 link 6, D5), spelled once on `notDeleted`'s terms
 * and for its reason: the whole risk of `moderated_at` is a read that forgets
 * it, and `grep notModerated` is the check.
 *
 * **Not `notDeleted` again, because the author keeps a moderated day.** A
 * deleted day is gone for everyone; a moderated one leaves every surface
 * somebody ELSE reads — the board, a profile, the shared-day count, the city
 * index — and stays in its owner's own library. So this constant is for the
 * surfaces that are never the owner's own, and `discoverDays`, which is both,
 * uses `notModeratedUnlessMine` instead.
 */
const notModerated = sql`and d.moderated_at is null`;

/**
 * Discover's half of the rule: a moderated day is visible to its owner and to
 * nobody else — `yours`, and `everyone` as the superset of `yours`, keep it for
 * the author, exactly as they keep the author's private days.
 *
 * `publishedOnly` (the profile's rule) takes the owner exception away: a
 * profile is what other people see, so its owner is shown the same page — the
 * reason `publishedOnly` exists at all.
 */
function notModeratedUnlessMine(query: DiscoverQuery): SQL {
  if (query.publishedOnly === true) return notModerated;
  return sql`and (d.moderated_at is null or d.owner_id = ${query.readerId})`;
}

/**
 * Which rows this scope may see at all — the one place the segment's meaning
 * lives, shared by the day query and the sibling-chip query so the chips can
 * never describe a set the cards are drawn from a different version of.
 *
 * `saved` carries a visibility guard as well as a ledger test, and that guard
 * is an exit-gate box: *"unpublishing removes it from that account's Discover
 * results."* Having taken a day once does not keep it visible after its author
 * withdraws it — the ledger row is a record of what happened, not a grant.
 */
function scopePredicate(scope: DiscoverScope, readerId: string): SQL {
  const isPublic = sql`d.visibility = ${SavedDayVisibility.enum.public}`;
  if (scope === "yours") return sql`d.owner_id = ${readerId}`;
  if (scope === "saved") {
    return sql`exists (
      select 1 from saved_day_adds a
      where a.saved_day_id = d.id and a.added_by = ${readerId}
    ) and (${isPublic} or d.owner_id = ${readerId})`;
  }
  // `everyone` is a SUPERSET of the other two, not "the public half"
  // (Mitchell, 2026-09-01). It was `isPublic` alone, which made the widest
  // option of the segment narrower than `Yours`: a private day of your own
  // showed under `Yours` and vanished under `Everyone`, which reads as the
  // filter losing your day. Nobody else's private day is reachable either way —
  // the owner clause is scoped to the reader, and `saved-day-access.ts` is
  // still the gate on an individual day.
  return sql`(${isPublic} or d.owner_id = ${readerId})`;
}

/** Everything except the ranking and the limit — shared by both queries. */
function matchPredicate(query: DiscoverQuery): SQL {
  // `sql.param`, not a bare `${array}`: drizzle FLATTENS a JS array in a
  // template hole into one placeholder per element, so `['Kyoto']` arrives as
  // the scalar `Kyoto` and Postgres refuses it ("malformed array literal").
  // `sql.param` binds the whole array as a single `text[]` parameter, which is
  // what the containment operator and the GIN index need.
  const cities = sql`${sql.param(query.cities)}::text[]`;
  const countries = sql`${sql.param(query.countries ?? [])}::text[]`;
  // **The season predicate is gone** (M26 link 2, SPEC §33.2): it filtered on
  // the month a day was run and nobody used it. `SEASON_MONTHS` and
  // `seasonOfMonth` stay — `pnpm content:verify` prints season occupancy and is
  // a separate consumer. Cutting the filter is not cutting the concept.
  //
  // The UTC pinning that comment used to explain went with it. If a month
  // predicate ever returns here, it needs `at time zone 'UTC'` again:
  // `extract(month from <timestamptz>)` resolves against the SESSION's TimeZone,
  // so the same row answers a different month depending on where the connection
  // thinks it is (review, pull request 102).
  return sql`
    ${scopePredicate(query.scope, query.readerId)}
    ${notDeleted}
    ${notModeratedUnlessMine(query)}
    and (${query.publishedOnly === true} = false or d.visibility = ${SavedDayVisibility.enum.public})
    and (
      (cardinality(${cities}) = 0 and cardinality(${countries}) = 0)
      or d.cities && ${cities}
      or d.countries && ${countries}
    )
    and (${query.authorId ?? null}::text is null or d.owner_id = ${query.authorId ?? null}::text)
    ${lengthPredicate(query.length)}
    ${ratingPredicate(query.rating ?? "any")}
  `;
}

/**
 * The rating floor, as SQL (M12 D9) — before the candidate window, like the
 * length band, so the chips and the page are counted from one set.
 *
 * An unrated day's `rating` is null and `null >= 4` is not true, so any floor
 * above `any` drops unrated days without a clause of its own — which is the
 * rule `RatingFloor` states.
 */
function ratingPredicate(floor: RatingFloor): SQL {
  if (floor === "any") return sql``;
  return sql` and d.rating >= ${RATING_FLOOR_MIN[floor]}`;
}

/**
 * The length filter, as SQL (M23).
 *
 * A real predicate rather than an application-side filter, and that is the
 * whole reason `day_count` is a column: applied here it narrows before
 * `CANDIDATE_LIMIT` truncates, so the sibling chips and the page they sit above
 * are counted from the same set. The budget band cannot have this and the
 * consequences are on record (KI-2026-08-31).
 *
 * `any` contributes nothing at all rather than a `true` term — one fewer thing
 * for the planner to look at on by far the most common query.
 */
function lengthPredicate(band: LengthBand): SQL {
  if (band === "any") return sql``;
  const [min, max] = LENGTH_BAND_RANGE[band];
  return max === null
    ? sql` and d.day_count >= ${min}`
    : sql` and d.day_count between ${min} and ${max}`;
}

/**
 * **Matched-city count first, then the chosen sort** — the milestone's ranking
 * rule, spelled in that order and not the other way round. A day that matches
 * two of the two cities you asked for outranks a day that matches one of them
 * however many times it has been added, because the ranking answers "how well
 * does this fit what you asked for" before "how popular is it".
 *
 * With countries in the query (M12 link 7, decision D7) `matched_count` is
 * matched cities PLUS matched countries: each selected place a day touches
 * counts one, whichever kind it is. So with `Kyoto` and `Japan` both selected,
 * a Kyoto day scores two and an Osaka day one — the day that fits more of what
 * was asked for still leads.
 */
function orderBy(sort: DiscoverSort): SQL {
  // Exhaustive by the `Record`: widening `DiscoverSort` without a clause here
  // is a type error, not a sort that silently falls through to "newest".
  const then = {
    "most-added": sql`d.adds desc, d.created_at desc`,
    "highest-rated": sql`d.rating desc nulls last, d.review_count desc`,
    "most-reviewed": sql`d.review_count desc, d.rating desc nulls last`,
    newest: sql`coalesce(d.published_at, d.created_at) desc`,
  }[sort];
  // `d.id` last so a page is stable when everything above it ties.
  return sql`matched_count desc, ${then}, d.id asc`;
}

/**
 * A stored row becomes a Discover card, or it becomes nothing.
 *
 * The same read boundary `savedDays.ts`'s `fromRow` draws, for the same reason
 * (KI-71): `stops` is `jsonb` with a compile-time `$type` cast that says what
 * the write path intends and nothing about what the bytes are. A row this
 * server can no longer read is dropped and logged, never allowed to fail the
 * whole page — one unreadable fragment must not take the other twenty-three
 * with it.
 */
function toDiscoverDay(row: DiscoverRow, queryCities: string[], readerId: string): DiscoverDay | null {
  // **The same helper `savedDays.ts`'s `fromRow` calls** (F-F05, and ADR-048
  // makes it a prerequisite of M23). This was a hand-copied duplicate of that
  // function's parses, with identical log strings, until the sequence work gave
  // the boundary three more behaviours to get identical — a `dayIndex` sort, a
  // `dayCount` floor, and the logging for both. A row that reads as a three-day
  // sequence in its owner's library and a two-day one on its Discover card is
  // worse than either answer.
  const parsed = parseSavedDayColumns({
    savedDayId: row.id,
    stops: row.stops,
    visibility: row.visibility,
    authorKind: row.author_kind,
    dayCount: row.day_count,
  });
  if (parsed === null) return null;
  const facts = savedDayFacts(parsed.stops, parsed.dayCount);
  const wanted = new Set(queryCities);
  return {
    savedDayId: row.id,
    ownerId: row.owner_id,
    name: row.name,
    cities: row.cities,
    // Derived from the day's OWN cities rather than echoed back from the query
    // string, so a card's chips are always spelled the way the day spells them.
    //
    // Exact, not case-folded, and deliberately the same comparison the SQL
    // does: containment (`cities && ARRAY[...]`) is what the GIN index serves
    // and it is exact, so a case-folded `matchedCities` would claim a match the
    // row filter did not make. Every city the UI sends came from
    // `GET /api/cities`, which returns the stored spelling — the two ends agree
    // because the names travel from the index, not from a keyboard.
    matchedCities: row.cities.filter((c) => wanted.has(c)),
    stopCount: facts.stopCount,
    // What the card states before a reader decides to open it (M23 link 4's
    // gate box). A sequence that does not say how many days it is is the same
    // surprise "add to trip" would spring later.
    dayCount: parsed.dayCount,
    window: facts.window,
    // Day one's first stops, in stored order — `dayIndex` 0 exactly, so a
    // Playbook whose first day was kept as a rest day previews nothing rather
    // than passing day two off as day one (a gap is an empty day, ADR-048).
    preview: parsed.stops
      .filter((stop) => stop.dayIndex === 0)
      .slice(0, DISCOVER_PREVIEW_STOPS)
      .map((stop) => ({ title: stop.title, start: stop.timeWindow?.start ?? null })),
    totalCost: facts.totalCost,
    adds: row.adds,
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: Number(row.review_count),
    visibility: parsed.visibility,
    // Falls back rather than dropping the card, for the reason `fromRow` in
    // `savedDays.ts` gives at length: this decides a label, not what the reader
    // is allowed to see, and only "ai" is ever rendered — so an unreadable
    // value says nothing about the author, which is the truth.
    authorKind: parsed.authorKind,
    sourceTripName: row.source_trip_name,
    // `createdAt` is `notNull` in the schema, so a null here means the row
    // shape is not what this query selected — not a day without a date.
    createdAt: isoOf(row.created_at) ?? new Date(0).toISOString(),
    publishedAt: isoOf(row.published_at),
    isMine: row.owner_id === readerId,
  };
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
 * chip would add". City matching is containment (`d.cities && ARRAY[...]`), so
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
function siblingCities(days: DiscoverDay[], queryCities: string[]): CityMatch[] {
  const asked = new Set(queryCities);
  const counts = new Map<string, number>();
  for (const day of days) {
    // `new Set` so a day is counted once per city even if `cities` ever grew a
    // duplicate — `unnest` + `count(*)` had the same exposure and the column is
    // written distinct, but a chip that counted one day twice would be the same
    // class of lie this function was just rewritten to stop telling.
    for (const city of new Set(day.cities)) {
      if (asked.has(city)) continue;
      counts.set(city, (counts.get(city) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([city, dayCount]) => ({ city, days: dayCount }))
    // UTF-16 code-unit order on the tiebreak, not `localeCompare`: this
    // replaced an `order by days desc, city asc` whose collation came from the
    // database, so pinning it to something that does not vary with a locale
    // keeps the row identical between a developer's machine, CI and production.
    // That determinism is the whole requirement and `<`/`>` meets it exactly.
    //
    // It is NOT codepoint order, which is what this comment claimed until
    // CodeRabbit read it (PR #123). JS `<` compares code units, so an
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
    .slice(0, SIBLING_LIMIT);
}

/**
 * How many days are published across the whole library, ignoring every filter.
 *
 * One `count(*)` on an indexed-enough predicate, run per Discover read, and
 * that is the whole cost: it exists so the page can withhold the leaderboard
 * link when there is nothing to rank (Mitchell, 2026-09-01 — *"Who shares the
 * most should be hidden when nothing to share"*), and a link that appears and
 * disappears with the city filter would be worse than one that never left.
 */
async function publishedDayCount(): Promise<number> {
  const rows = await db.execute<{ days: number }>(sql`
    select count(*)::int as days
    from saved_days d
    where d.visibility = ${SavedDayVisibility.enum.public}
      ${notDeleted}
      ${notModerated}
  `);
  return Number(rows.rows[0]?.days ?? 0);
}

export async function discoverDays(query: DiscoverQuery): Promise<DiscoverResponse> {
  const cities = sql`${sql.param(query.cities)}::text[]`;
  const countries = sql`${sql.param(query.countries ?? [])}::text[]`;
  const rows = await db.execute<DiscoverRow>(sql`
    select
      d.id, d.owner_id, d.name, d.stops, d.cities, d.visibility, d.adds, d.rating, d.review_count,
      d.author_kind, d.day_count, d.source_trip_name, d.created_at, d.published_at,
      (cardinality(array(
        select unnest(d.cities) intersect select unnest(${cities})
      )) + cardinality(array(
        select unnest(d.countries) intersect select unnest(${countries})
      )))::int as matched_count
    from saved_days d
    where ${matchPredicate(query)}
    order by ${orderBy(query.sort)}
    limit ${CANDIDATE_LIMIT}
  `);

  const candidates = [...rows.rows]
    .map((row) => toDiscoverDay(row, query.cities, query.readerId))
    .filter((day): day is DiscoverDay => day !== null);

  // The one currency every matched day agrees on, or null. Decided over the
  // candidates rather than the page so the budget control does not appear and
  // disappear as you scroll. See `BudgetBand` for why a mixed set hides it
  // rather than comparing numbers that are not comparable.
  const currencies = new Set(
    candidates.map((d) => d.totalCost?.currency).filter((c): c is string => c !== undefined),
  );
  const budgetCurrency = currencies.size === 1 ? [...currencies][0]! : null;

  const filtered = candidates.filter((day) =>
    inBudgetBand(query.budget, day.totalCost?.amountMinor ?? null),
  );

  return {
    days: filtered.slice(0, PAGE_LIMIT),
    // `filtered`, not `candidates` and not the page: the chips describe the set
    // the cards come from, band included. See `siblingCities`.
    siblings: siblingCities(filtered, query.cities),
    budgetCurrency,
    // Unfiltered on purpose — see `sharedDayCount` on the response. It answers
    // "is there a library at all", which is what decides whether the
    // leaderboard link has anything to rank, and no filter on this query may
    // change that answer.
    sharedDayCount: await publishedDayCount(),
    // BOTH caps, not just the candidate window. There is no pagination — the
    // page's answer to truncation is "narrow the cities" — so a query matching
    // 25 to 199 days used to return 24 cards flagged as the complete set, with
    // no way to reach the rest and nothing on screen saying they existed
    // (CodeRabbit, PR 102). The profile day list is this same function, and
    // it says the same thing there by comparing its card count against
    // `daysShared`.
    truncated: rows.rows.length === CANDIDATE_LIMIT || filtered.length > PAGE_LIMIT,
  };
}

/**
 * Per author: the reviews their published days have received, and the mean of
 * those reviews — `PublicAuthor.reviewsReceived` / `averageRating`.
 *
 * Read off the denormalised counters rather than `saved_day_reviews`, because
 * those are what Discover's cards show and a profile must not disagree with
 * them. `sum(rating * review_count) / sum(review_count)` is the mean of the
 * REVIEWS, not a mean of per-day means. Its own CTE rather than two more
 * aggregates in the queries below: those join `saved_day_adds`, which repeats
 * each day once per add and would multiply every sum here by it.
 *
 * Published, not deleted, not moderated — what a stranger can see is what a
 * stranger's numbers are made of.
 */
const reviewTotals = sql`review_totals as (
  select
    d.owner_id,
    sum(d.review_count)::int as reviews_received,
    sum(d.rating * d.review_count) / nullif(sum(d.review_count), 0) as average_rating
  from saved_days d
  where d.visibility = ${SavedDayVisibility.enum.public}
    ${notModerated}
    ${notDeleted}
  group by d.owner_id
)`;

type AuthorRow = {
  owner_id: string;
  adds: number;
  days_shared: number;
  reviews_received: number | null;
  average_rating: number | null;
};

/**
 * Everyone who has ever had a day taken, ranked on the ledger.
 *
 * **`count(*)` over `saved_day_adds`, never `sum(saved_days.adds)`.** The
 * counter is denormalised from this table and the milestone's copy promises the
 * board ranks on the ledger; ranking on the copy would make the board agree
 * with the ledger only until the two came apart, which is precisely the bug
 * this shape exists to make impossible to hide. It is also what makes the
 * exit-gate agreement check meaningful — a profile counted from the ledger and
 * a Discover card showing the counter can be compared.
 *
 * A ledger row only ever exists for a day that was readable when it was taken,
 * which is the author's own or a published one, and an author's own add never
 * counts (`addCounts`). So counting every ledger row cannot credit anyone for a
 * private day, and unpublishing afterwards does not retroactively erase a
 * genuine add somebody made.
 *
 * No empty state and no limit: §15 rules the first out by construction (the
 * board cannot be empty while any day is shared) and the population is invited
 * and small, so ranking is over everyone rather than a top-N that would need a
 * "and 40 others" line nobody asked for.
 */
export async function leaderboard(): Promise<PublicAuthor[]> {
  const rows = await db.execute<AuthorRow>(sql`
    with ${reviewTotals}
    select
      d.owner_id,
      count(a.saved_day_id)::int as adds,
      count(distinct d.id) filter (where d.visibility = ${SavedDayVisibility.enum.public})::int as days_shared,
      rt.reviews_received,
      rt.average_rating
    from saved_days d
    left join saved_day_adds a on a.saved_day_id = d.id
    left join review_totals rt on rt.owner_id = d.owner_id
    -- "where true" so the shared filter drops in with its leading "and"; this
    -- is the only query here with no predicate of its own. The LEFT JOIN keeps
    -- every ledger row of a day that still exists, which is the point: deleting
    -- a day drops it out of days_shared, and does NOT erase adds somebody
    -- genuinely made against the days that remain.
    --
    -- A moderated day is dropped the same way, adds and all: it is off the
    -- board, and its ledger rows come back with it on restore.
    where true ${notDeleted} ${notModerated}
    group by d.owner_id, rt.reviews_received, rt.average_rating
    having count(a.saved_day_id) > 0
        or count(*) filter (where d.visibility = ${SavedDayVisibility.enum.public}) > 0
    order by adds desc, days_shared desc, d.owner_id asc
  `);
  return [...rows.rows].map(toAuthor);
}

function toAuthor(row: AuthorRow): PublicAuthor {
  return {
    userId: String(row.owner_id),
    // The M17 seam. One resolver, and today it returns the identifier — see
    // `lib/displayName.ts` for the recorded decision behind that.
    displayName: displayNameFor({ userId: String(row.owner_id) }),
    daysShared: Number(row.days_shared),
    adds: Number(row.adds),
    reviewsReceived: Number(row.reviews_received ?? 0),
    averageRating: row.average_rating === null ? null : Number(row.average_rating),
  };
}

/**
 * What a profile with nothing on it is called. The same string `displayNameFor`
 * itself falls back to for an id with no readable characters, so the app has
 * one neutral name for a person it cannot name rather than two.
 */
const NO_ONE_IN_PARTICULAR = "A traveler";

/**
 * One person's numbers, computed the same way the board computes everyone's.
 *
 * Shared by the public profile AND by the shared-day route's author strip, so
 * "days shared / how often their days were added" cannot say one thing beside a
 * day and another on the profile that day links to.
 *
 * Returns a zeroed author rather than null for someone with no days: a profile
 * reached from a stale link is an honest empty page, not a 404 that implies the
 * account does not exist — which would be a way to probe for accounts.
 */
export async function publicAuthor(userId: string): Promise<PublicAuthor> {
  const rows = await db.execute<AuthorRow>(sql`
    with ${reviewTotals}
    select
      ${userId}::text as owner_id,
      count(a.saved_day_id)::int as adds,
      count(distinct d.id) filter (where d.visibility = ${SavedDayVisibility.enum.public})::int as days_shared,
      (select rt.reviews_received from review_totals rt where rt.owner_id = ${userId}) as reviews_received,
      (select rt.average_rating from review_totals rt where rt.owner_id = ${userId}) as average_rating
    from saved_days d
    left join saved_day_adds a on a.saved_day_id = d.id
    where d.owner_id = ${userId}
      ${notDeleted}
      ${notModerated}
  `);
  // Exactly one row, always. This is an ungrouped aggregate — no `group by` —
  // and SQL evaluates one of those over the whole (possibly empty) input and
  // returns a single row of zeros. Verified against a real database for a
  // userId with no `saved_days` at all: `rows.rows.length = 1`,
  // `{adds: 0, days_shared: 0}`. What stood here was a `row === undefined`
  // ternary whose branch could not be reached and whose two arms produced the
  // same author anyway (KI-2026-09-05-y / F-G05). The non-null assertion is
  // the claim above, stated where it is relied on.
  const row = rows.rows[0]!;
  const author = toAuthor({ ...row, owner_id: userId });

  // A person with nothing gets NO derived handle. `displayNameFor` will turn
  // any string into something person-shaped — `publicAuthor("someuserxyz")`
  // returned `"Traveler serxyz"` — and this is the one call site whose
  // argument is a URL segment a stranger typed, so a mistyped or invented id
  // rendered as a plausible individual who has simply shared nothing
  // (KI-2026-09-05-y / F-G05).
  //
  // Deliberately NOT a `users` lookup and a 404: that answers "does this
  // account exist" for anyone who asks, which is exactly what the docstring
  // above refuses to do. Zero days and zero adds is the strongest statement
  // that can be made without asking that question, and it is true of every
  // nonexistent id — so the neutral name costs nothing on a page that has
  // nothing to attribute, while everyone the leaderboard actually ranks (adds
  // or days > 0) keeps the distinct suffix it needs.
  return author.daysShared === 0 && author.adds === 0 ? { ...author, displayName: NO_ONE_IN_PARTICULAR } : author;
}

/**
 * The cities a person's PUBLISHED days touch, with how many of their days each.
 *
 * §15's "Knows" chips, and the reason they are derived rather than authored:
 * every chip is `citiesOfStops` over a day the profile also lists, so tapping
 * one and landing in Discover cannot produce a different set of days than the
 * number on the chip promised.
 */
export async function citiesKnownBy(userId: string): Promise<CityMatch[]> {
  const rows = await db.execute<{ city: string; days: number }>(sql`
    select city, count(*)::int as days
    from saved_days d, unnest(d.cities) as city
    where d.owner_id = ${userId} and d.visibility = ${SavedDayVisibility.enum.public}
      ${notDeleted}
      ${notModerated}
    group by city
    order by days desc, city asc
  `);
  return [...rows.rows].map((row) => ({ city: String(row.city), days: Number(row.days) }));
}
