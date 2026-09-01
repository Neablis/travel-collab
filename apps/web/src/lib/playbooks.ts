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
 * Budget per person, in bands rather than a slider — three ranges over the sum
 * of a day's priced stops.
 *
 * The thresholds are minor units and are compared WITHIN one currency: a
 * response carries `budgetCurrency`, the single currency every matched day
 * agrees on, or null when they do not. ADR-008 makes currency trip-level and a
 * saved day is lifted out of one trip, so in practice a result set is
 * single-currency; when it is not, the filter hides rather than comparing two
 * numbers that are not comparable.
 */
export const BudgetBand = z.enum(["any", "under", "mid", "over"]);
export type BudgetBand = z.infer<typeof BudgetBand>;

/** The two band edges, in minor units. $50 and $150 at 2-decimal currencies. */
export const BUDGET_BAND_EDGES = { lower: 5_000, upper: 15_000 } as const;

/** `any` accepts a day with no priced stops at all; the other three do not. */
export function inBudgetBand(band: BudgetBand, amountMinor: number | null): boolean {
  if (band === "any") return true;
  if (amountMinor === null) return false;
  if (band === "under") return amountMinor < BUDGET_BAND_EDGES.lower;
  if (band === "mid") return amountMinor >= BUDGET_BAND_EDGES.lower && amountMinor <= BUDGET_BAND_EDGES.upper;
  return amountMinor > BUDGET_BAND_EDGES.upper;
}

/**
 * One Discover card. Deliberately NOT a `SavedDay`.
 *
 * A card shows derived facts — how many stops, the window they span, what it
 * costs each, which of its cities the query matched — and never the stops
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
  /** Sum of the day's priced stops; null when nothing is priced or currencies disagree. */
  budgetPerPerson: Money.nullable(),
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
