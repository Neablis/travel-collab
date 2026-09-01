import { z } from "zod";
import { Money, TimeWindow } from "@tc/contracts";
import { CityMatch } from "@/lib/cities";

// The wire shapes of the public library's three read endpoints (M11b PR3):
// `GET /api/playbooks` (Discover), `GET /api/playbooks/board` (leaderboard)
// and `GET /api/playbooks/profile/:userId`. Defined ONCE and read from both
// sides — the routes validate what they are about to send, `apiClient` parses
// what it received.
//
// **Where these really belong is `packages/contracts`**, and this file is here
// for exactly the reason `lib/cities.ts` gives for `CityMatch`: M11b's
// contracts step was its own reviewed PR (AGENTS.md: "a contract change is its
// own reviewed step before dependent feature work continues") and it has
// already landed, so adding schemas to it from the ROUTE PR is the drift that
// rule exists to stop. Flagged here rather than done quietly, and the two
// files should be promoted together — the shapes below are deliberately plain
// so that promotion is a cut and paste.

/**
 * The two sorts M11b ships, and **not** §15's four.
 *
 * `highest-rated` and `most-reviewed` need a reviews table that does not exist
 * until M12, and the milestone's own reasoning for dropping the rating floor
 * applies to them verbatim: a control over data that does not exist is a
 * control that does nothing (project rule 2). Restored with the reviews.
 */
export const DiscoverSort = z.enum(["most-added", "newest"]);
export type DiscoverSort = z.infer<typeof DiscoverSort>;

/**
 * `Everyone / Yours / Saved` — a SCOPE on this one page, never a second page
 * (§15's R5, and the milestone's "your own library is a filter on this page").
 *
 *   * `everyone` — a superset: every published day, PLUS every day of your own,
 *     published or not. Mitchell, 2026-09-01: *"Everyone tab for playbooks
 *     should also include my trips, it's an 'Everyone' superset"*. Before that
 *     it was public-only, so `Yours` could show a private day that `Everyone`
 *     did not — a segment whose widest option was not the widest set.
 *   * `yours` — days you authored, **published or not**. This is the only place
 *     a private day of yours appears in Discover, and it is what makes the
 *     scope segment a replacement for a separate library page rather than a
 *     narrowing of the public one.
 *   * `saved` — days you have TAKEN: the adds ledger, keyed on `added_by`.
 *     There is no bookmark table and inventing one is M12-shaped, so "saved"
 *     is answered from the record of what you actually did with a day. The UI
 *     labels it in those words rather than as a wishlist it is not.
 */
export const DiscoverScope = z.enum(["everyone", "yours", "saved"]);
export type DiscoverScope = z.infer<typeof DiscoverScope>;

/**
 * The season a day belongs to — Discover's coarse "when is this good for"
 * filter, replacing the month dropdown that stood here.
 *
 * **Derived from a month, never stored.** Mitchell, 2026-09-01: *"Search should
 * also be season (Spring, Summer, Winter, Fall) and automatically bucket that
 * from the month it was first cloned from (no db just do a lookup for now)"* —
 * so this is a pure lookup over the one month a saved day actually carries
 * (`created_at`, the month it was lifted out of its source trip), and no column
 * is added to hold it. When a saved day gains a real "the month the source trip
 * ran" field, `seasonOfMonth` is the only thing that has to be re-pointed.
 *
 * Meteorological buckets, northern hemisphere: the library is invite-only and
 * its whole demo corpus is Japan, so a single hemisphere is the honest reading
 * rather than a fake-global one. Spelled "fall" rather than "autumn" because
 * that is the word the request used and the rest of the product's copy is
 * en-US.
 */
export const Season = z.enum(["spring", "summer", "fall", "winter"]);
export type Season = z.infer<typeof Season>;

/** 1-12, the way `extract(month from ...)` and `Date#getUTCMonth() + 1` count. */
export const SEASON_MONTHS: Record<Season, readonly number[]> = {
  spring: [3, 4, 5],
  summer: [6, 7, 8],
  fall: [9, 10, 11],
  winter: [12, 1, 2],
};

export const SEASON_LABELS: Record<Season, string> = {
  spring: "Spring",
  summer: "Summer",
  fall: "Fall",
  winter: "Winter",
};

/**
 * Which season a 1-12 month falls in, or null for anything that is not a month.
 *
 * Total over the twelve real months by construction — the lookup is built from
 * `SEASON_MONTHS`, so a bucket edit cannot leave a month homeless the way a
 * hand-written switch could.
 */
const MONTH_TO_SEASON: ReadonlyMap<number, Season> = new Map(
  (Object.entries(SEASON_MONTHS) as [Season, readonly number[]][]).flatMap(([season, months]) =>
    months.map((month) => [month, season] as const),
  ),
);

export function seasonOfMonth(month: number | null | undefined): Season | null {
  if (month === null || month === undefined) return null;
  return MONTH_TO_SEASON.get(month) ?? null;
}

/** The season an instant (a saved day's `createdAt`) falls in, read in UTC. */
export function seasonOfInstant(iso: string): Season | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  return seasonOfMonth(at.getUTCMonth() + 1);
}

/**
 * A day's TOTAL cost, in bands rather than a slider — four ranges over the sum
 * of its priced stops.
 *
 * This docstring opened "Budget per person" until 2026-09-01, and the number it
 * bands never was one: `savedDayFacts` adds up `stop.cost` and divides by
 * nothing. Mitchell: *"why are we calculating per person in a notebook? just
 * show total cost there, any per person logic and math should go into the
 * future milestone around cost."* The control is unchanged — same edges, same
 * `?budget=` values — only the claim about what it compares.
 *
 * Four bands, not three: Mitchell, Vercel toolbar comment on `/playbooks` at
 * 411px with the budget `<select>` selected (2026-09-01): *"the default
 * budget options are pretty unrealistic, let's make them sub 200, sub 500,
 * sub 1000 and above 1000."* His four numbers are EDGES, not four independent
 * "cheaper than N" thresholds — a `<select>`'s options have to be mutually
 * exclusive or a day could match two of them at once, so this reads the
 * request as: under $200; $200-$500; $500-$1,000; over $1,000. Flagged here
 * rather than assumed silently — if he actually meant four overlapping
 * "at most N" toggles, that is a different control (checkboxes, not a
 * `<select>`) and this needs to be redone, not just relabeled.
 *
 * Named for the range each one covers, not its position. `under`/`mid`/`over`
 * cannot hold a fourth member without one of the three names starting to mean
 * something else depending on how many bands exist that day — and a `mid`
 * that silently became "$500-$1,000" instead of the old "$50-$150" is exactly
 * the kind of link rot a saved/shared `?budget=mid` URL should not suffer
 * quietly. Because these are new strings, an old link's `mid` no longer
 * parses as anything: `BudgetBand.catch("any")` in
 * `app/api/playbooks/route.ts` turns it into `any`, which is the right
 * fallback for a stale value — the widest scope, not a wrong answer.
 *
 * The thresholds are minor units and are compared WITHIN one currency: a
 * response carries `budgetCurrency`, the single currency every matched day
 * agrees on, or null when they do not. ADR-008 makes currency trip-level and a
 * saved day is lifted out of one trip, so in practice a result set is
 * single-currency; when it is not, the filter hides rather than comparing two
 * numbers that are not comparable.
 */
export const BudgetBand = z.enum(["any", "under200", "200to500", "500to1000", "over1000"]);
export type BudgetBand = z.infer<typeof BudgetBand>;

/** The three band edges, in minor units. $200 / $500 / $1,000 at 2-decimal currencies. */
export const BUDGET_BAND_EDGES = { twoHundred: 20_000, fiveHundred: 50_000, oneThousand: 100_000 } as const;

/**
 * `any` accepts a day with no priced stops at all; the other four do not.
 *
 * `amountMinor` is a day's total (`SavedDayFacts.totalCost`), not a per-head
 * share — see `BudgetBand` above for why that stopped being claimed.
 *
 * Each band's lower edge is inclusive and its upper edge is exclusive, and
 * the top band is open-ended — the ordinary "$X+" reading a price filter
 * gets (an Amazon-style price-range control, not a mathematician's closed
 * interval): a day priced at exactly $200 lands in `200to500`, not
 * `under200`, and a day at exactly $1,000 lands in `over1000`, not
 * `500to1000`. That makes the label on the top option ("Over $1,000") a hair
 * loose at the boundary itself — an exactly-$1,000 day is not literally
 * "over" — which is the same trade every "$1,000+" filter anywhere makes.
 * Pinned by tests at all three edges so which side a boundary falls on is a
 * decision on record, not an accident of `<`/`<=` in one line.
 */
export function inBudgetBand(band: BudgetBand, amountMinor: number | null): boolean {
  if (band === "any") return true;
  if (amountMinor === null) return false;
  if (band === "under200") return amountMinor < BUDGET_BAND_EDGES.twoHundred;
  if (band === "200to500") {
    return amountMinor >= BUDGET_BAND_EDGES.twoHundred && amountMinor < BUDGET_BAND_EDGES.fiveHundred;
  }
  if (band === "500to1000") {
    return amountMinor >= BUDGET_BAND_EDGES.fiveHundred && amountMinor < BUDGET_BAND_EDGES.oneThousand;
  }
  return amountMinor >= BUDGET_BAND_EDGES.oneThousand; // over1000, the only band left standing
}

/**
 * One Discover card. Deliberately NOT a `SavedDay`.
 *
 * A card shows derived facts — how many stops, the window they span, what the
 * whole day costs, which of its cities the query matched — and never the stops
 * themselves, which are the heavy half of a `SavedDay` and are what the shared
 * day route exists to show. Sending 30 days' stop arrays to render 30 summary
 * cards would be sending the whole library on every keystroke.
 */
export const DiscoverDay = z.object({
  savedDayId: z.string().uuid(),
  ownerId: z.string().min(1),
  name: z.string().min(1),
  /** Every city the day touches, in the day's own time order (`citiesOfStops`). */
  cities: z.array(z.string().min(1)),
  /**
   * The subset of `cities` the query asked for — what the card fills in rather
   * than outlining, and what the per-card line ("Kyoto matched · also Osaka")
   * is built from. Empty on an unfiltered browse, where nothing was asked for.
   */
  matchedCities: z.array(z.string().min(1)),
  stopCount: z.number().int().nonnegative(),
  /** First stop's start to last stop's end; null when no stop carries a time. */
  window: TimeWindow.nullable(),
  /**
   * Sum of the day's priced stops; null when nothing is priced or currencies
   * disagree. The day's TOTAL — nothing divides it by a traveller count,
   * because there is no traveller count.
   *
   * **This wire field was `budgetPerPerson` and renamed here on pull request
   * 104** (Mitchell, 2026-09-01: *"just show total cost there"*). `DiscoverDay`
   * is a local response shape, not `packages/contracts`, so invariant 5's
   * contract protocol does not apply and there is no changelog entry to write —
   * but the rename is still a wire break, so: an old client would find no
   * `budgetPerPerson` on the response and simply render no money line, because
   * `DiscoverCard` guards on the field being non-null. Nothing persists a
   * `DiscoverDay` — no storage, no cache, no fixture, no external reader; the
   * only producer is `server/playbooks.ts` and the only consumer is
   * `DiscoverCard`, both shipped together — so no stored row carries the old
   * key and there is no reader to keep an alias for.
   */
  totalCost: Money.nullable(),
  adds: z.number().int().nonnegative(),
  visibility: z.enum(["private", "public"]),
  sourceTripName: z.string().min(1),
  createdAt: z.string(),
  publishedAt: z.string().nullable(),
  /** Whether the signed-in reader authored it — decides the "Yours" badge. */
  isMine: z.boolean(),
});
export type DiscoverDay = z.infer<typeof DiscoverDay>;

export const DiscoverResponse = z.object({
  days: z.array(DiscoverDay),
  /**
   * Cities present in the MATCHED set but absent from the query, with counts —
   * §15's sibling chips, "one tap to add". Computed over the whole matched set
   * rather than the returned page, so a chip's count is the number of days that
   * city would actually add rather than the number that happened to fit.
   *
   * On an empty query this is the "busy right now" row instead: the busiest
   * cities in the published library, which is the same question with no
   * subtraction to do.
   */
  siblings: z.array(CityMatch),
  /** The single currency every matched day agrees on, or null (see `BudgetBand`). */
  budgetCurrency: z.string().nullable(),
  /**
   * True when the ranked candidate window was full, so the budget/season filters
   * ran over a prefix of the matches rather than all of them. Surfaced rather
   * than hidden: a filtered count that silently means "of the first 200" is a
   * number the page cannot stand behind.
   */
  truncated: z.boolean(),
  /**
   * How many days are published across the WHOLE library, ignoring every filter
   * on this query.
   *
   * It exists for one control: the leaderboard link. *"Who shares the most"*
   * over a library nobody has shared anything into ranks an empty column, so
   * the link is withheld until there is something to rank (Mitchell,
   * 2026-09-01). Deliberately not derived from `days` — that list is filtered,
   * and a Hakone query returning nothing does not mean nobody shares.
   */
  sharedDayCount: z.number().int().nonnegative(),
});
export type DiscoverResponse = z.infer<typeof DiscoverResponse>;

/**
 * One person, as the leaderboard and the author strip see them.
 *
 * **Derived, never authored** (§15's public profiles). Every number here is
 * computed from that person's days and the adds ledger, so a profile cannot
 * disagree with Discover — there is no public user record to fall out of sync
 * with, and adding one is explicitly not needed.
 */
export const PublicAuthor = z.object({
  userId: z.string().min(1),
  /**
   * What to call them. Today this is the identifier — M17 is what resolves it
   * to a chosen display name, and it fills this by changing ONE function
   * (`lib/displayName.ts`), not two routes.
   */
  displayName: z.string().min(1),
  /** Days currently published. A private day is not "shared". */
  daysShared: z.number().int().nonnegative(),
  /**
   * Ledger rows against this person's days — "how often their days were added".
   * Counted from `saved_day_adds`, never from the denormalised counter, so the
   * board ranks on the ledger and nothing else.
   */
  adds: z.number().int().nonnegative(),
});
export type PublicAuthor = z.infer<typeof PublicAuthor>;

export const LeaderboardResponse = z.object({
  /** Ranked by `adds` descending. Your own row is in place, never lifted. */
  authors: z.array(PublicAuthor),
  /** Which row is yours, so the page can tint it without knowing your id. */
  meUserId: z.string().min(1),
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;

export const PublicProfileResponse = z.object({
  author: PublicAuthor,
  /** Cities this person's published days touch, with how many of their days each. */
  knows: z.array(CityMatch),
  /** Their published days, newest first — the same card shape Discover renders. */
  days: z.array(DiscoverDay),
});
export type PublicProfileResponse = z.infer<typeof PublicProfileResponse>;
