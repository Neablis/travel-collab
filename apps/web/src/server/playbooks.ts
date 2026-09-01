import { sql, type SQL } from "drizzle-orm";
import { SavedDayVisibility, SavedStop } from "@tc/contracts";
import type { CityMatch } from "@/lib/cities";
import {
  inBudgetBand,
  SEASON_MONTHS,
  type BudgetBand,
  type DiscoverDay,
  type DiscoverResponse,
  type DiscoverScope,
  type DiscoverSort,
  type PublicAuthor,
  type Season,
} from "@/lib/playbooks";
import { savedDayFacts } from "@/lib/savedDayFacts";
import { displayNameFor } from "@/lib/displayName";
import { db } from "./db/client";

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
  scope: DiscoverScope;
  sort: DiscoverSort;
  budget: BudgetBand;
  /**
   * The season asked for, or null for any.
   *
   * Bucketed from `created_at`'s month rather than from a stored season — see
   * `Season` in `lib/playbooks.ts` for why there is no column behind this.
   */
  season: Season | null;
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
  adds: number;
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
  // `at time zone 'UTC'` is load-bearing, not decoration. `created_at` is
  // `timestamptz`, and `extract(month from <timestamptz>)` resolves against the
  // SESSION's TimeZone — so the same row can answer a different month depending
  // on where the connection thinks it is. `SharedDayScreen` derives the season
  // it displays with `getUTCMonth()`, so the filter has to be pinned to UTC or
  // a day saved near a month boundary is filtered out of the season it shows.
  // Raised by review on pull request 102.
  //
  // The season is expanded to its months HERE rather than being stored: one
  // lookup (`SEASON_MONTHS`) decides the buckets for the SQL, the card and the
  // shared-day rail alike, so none of the three can disagree about which
  // months are Fall.
  const seasonMonths = sql`${sql.param(query.season === null ? [] : [...SEASON_MONTHS[query.season]])}::int[]`;
  return sql`
    ${scopePredicate(query.scope, query.readerId)}
    ${notDeleted}
    and (${query.publishedOnly === true} = false or d.visibility = ${SavedDayVisibility.enum.public})
    and (cardinality(${cities}) = 0 or d.cities && ${cities})
    and (cardinality(${seasonMonths}) = 0 or extract(month from d.created_at at time zone 'UTC') = any(${seasonMonths}))
    and (${query.authorId ?? null}::text is null or d.owner_id = ${query.authorId ?? null}::text)
  `;
}

/**
 * **Matched-city count first, then the chosen sort** — the milestone's ranking
 * rule, spelled in that order and not the other way round. A day that matches
 * two of the two cities you asked for outranks a day that matches one of them
 * however many times it has been added, because the ranking answers "how well
 * does this fit what you asked for" before "how popular is it".
 */
function orderBy(sort: DiscoverSort): SQL {
  const then =
    sort === "most-added"
      ? sql`d.adds desc, d.created_at desc`
      : sql`coalesce(d.published_at, d.created_at) desc`;
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
  const stops = SavedStop.array().safeParse(row.stops);
  if (!stops.success) {
    console.error("saved_days.stops failed SavedStop[] parse", {
      savedDayId: row.id,
      issues: stops.error.issues,
    });
    return null;
  }
  const visibility = SavedDayVisibility.safeParse(row.visibility);
  if (!visibility.success) {
    console.error("saved_days.visibility is not a SavedDayVisibility", {
      savedDayId: row.id,
      value: row.visibility,
    });
    return null;
  }
  const facts = savedDayFacts(stops.data);
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
    window: facts.window,
    totalCost: facts.totalCost,
    adds: row.adds,
    visibility: visibility.data,
    sourceTripName: row.source_trip_name,
    // `createdAt` is `notNull` in the schema, so a null here means the row
    // shape is not what this query selected — not a day without a date.
    createdAt: isoOf(row.created_at) ?? new Date(0).toISOString(),
    publishedAt: isoOf(row.published_at),
    isMine: row.owner_id === readerId,
  };
}

/**
 * Cities in the matched set that the query did NOT ask for, with counts —
 * §15's sibling chips.
 *
 * Computed over the whole matched set rather than over the returned page, so a
 * chip's count is the number of days tapping it would actually add rather than
 * the number that happened to fit on the page.
 *
 * With an empty query there is nothing to subtract and this is the *"busy right
 * now"* row instead — the busiest cities in the library. One query serves both,
 * which is why there is no second "popular cities" endpoint.
 */
async function siblingCities(query: DiscoverQuery): Promise<CityMatch[]> {
  const rows = await db.execute<{ city: string; days: number }>(sql`
    select city, count(*)::int as days
    from saved_days d, unnest(d.cities) as city
    where ${matchPredicate(query)}
      and city <> all(${sql.param(query.cities)}::text[])
    group by city
    order by days desc, city asc
    limit ${SIBLING_LIMIT}
  `);
  return [...rows.rows].map((row) => ({ city: String(row.city), days: Number(row.days) }));
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
  `);
  return Number(rows.rows[0]?.days ?? 0);
}

export async function discoverDays(query: DiscoverQuery): Promise<DiscoverResponse> {
  const cities = sql`${sql.param(query.cities)}::text[]`;
  const rows = await db.execute<DiscoverRow>(sql`
    select
      d.id, d.owner_id, d.name, d.stops, d.cities, d.visibility, d.adds,
      d.source_trip_name, d.created_at, d.published_at,
      cardinality(array(
        select unnest(d.cities) intersect select unnest(${cities})
      ))::int as matched_count
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
    siblings: await siblingCities(query),
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
  const rows = await db.execute<{ owner_id: string; adds: number; days_shared: number }>(sql`
    select
      d.owner_id,
      count(a.saved_day_id)::int as adds,
      count(distinct d.id) filter (where d.visibility = ${SavedDayVisibility.enum.public})::int as days_shared
    from saved_days d
    left join saved_day_adds a on a.saved_day_id = d.id
    -- "where true" so the shared filter drops in with its leading "and"; this
    -- is the only query here with no predicate of its own. The LEFT JOIN keeps
    -- every ledger row of a day that still exists, which is the point: deleting
    -- a day drops it out of days_shared, and does NOT erase adds somebody
    -- genuinely made against the days that remain.
    where true ${notDeleted}
    group by d.owner_id
    having count(a.saved_day_id) > 0
        or count(*) filter (where d.visibility = ${SavedDayVisibility.enum.public}) > 0
    order by adds desc, days_shared desc, d.owner_id asc
  `);
  return [...rows.rows].map(toAuthor);
}

function toAuthor(row: { owner_id: string; adds: number; days_shared: number }): PublicAuthor {
  return {
    userId: String(row.owner_id),
    // The M17 seam. One resolver, and today it returns the identifier — see
    // `lib/displayName.ts` for the recorded decision behind that.
    displayName: displayNameFor({ userId: String(row.owner_id) }),
    daysShared: Number(row.days_shared),
    adds: Number(row.adds),
  };
}

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
  const rows = await db.execute<{ owner_id: string; adds: number; days_shared: number }>(sql`
    select
      ${userId}::text as owner_id,
      count(a.saved_day_id)::int as adds,
      count(distinct d.id) filter (where d.visibility = ${SavedDayVisibility.enum.public})::int as days_shared
    from saved_days d
    left join saved_day_adds a on a.saved_day_id = d.id
    where d.owner_id = ${userId}
      ${notDeleted}
  `);
  const row = rows.rows[0];
  return row === undefined
    ? { userId, displayName: displayNameFor({ userId }), daysShared: 0, adds: 0 }
    : toAuthor({ ...row, owner_id: userId });
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
    group by city
    order by days desc, city asc
  `);
  return [...rows.rows].map((row) => ({ city: String(row.city), days: Number(row.days) }));
}
