import type { Metadata } from "next";
import { pageMetadata } from "./siteMetadata";

// The two Playbooks cards that name nobody (spec 2026-10-02 §2.7): Discover's
// and the board's. Here rather than in `server/og/copy.ts` because the pages
// state them too, as their static metadata, and a page file cannot import
// `@/server` (AGENTS.md's lint wall). `copy.ts` re-exports them, so the image
// and the <head> read one string.

/** The words Discover leads with, and what every generic Playbooks card says under its title. */
export const DISCOVER_LINE = "Days other people planned and rated. Find one for your city and drop it into your trip.";

/** The generic Playbooks card: `/playbooks`, and every day, profile or city lookup that misses. */
export const PLAYBOOKS_GENERIC = {
  label: "Caesura · playbooks",
  title: "Playbooks on Caesura",
  description: DISCOVER_LINE,
} as const;

/** The board's card, `/playbooks/board`. Its heading, over the Discover line. */
export const PLAYBOOKS_BOARD = {
  label: "Caesura · playbooks",
  title: "Who shares the most",
  description: DISCOVER_LINE,
} as const;

/** Where the static Playbooks card is drawn; `?board=1` draws the board's. */
export const PLAYBOOKS_CARD_PATH = "/api/og/playbooks";

/**
 * A Playbooks page's metadata with a static card: `pageTitle` in the tab, the
 * card's own words as og:title and og:description, and og:image at the card.
 * Also every per-link page's fallback, for when its `meta` lookup misses.
 */
export function playbooksPageMetadata(
  pageTitle: string,
  card: { title: string; description: string } = PLAYBOOKS_GENERIC,
  imagePath: string = PLAYBOOKS_CARD_PATH,
): Metadata {
  const { title, description } = card;
  // `linkPreviewMetadata`'s split: the card's sentence is og:title, and the
  // tab keeps the page's own name under the layout's template.
  return { ...pageMetadata({ title: { absolute: title }, description, image: { url: imagePath, alt: title } }), title: pageTitle };
}

/** What a day page's tab says when the day is not one this reader may open. */
export const DAY_FALLBACK_TITLE = "A playbook";

/** The numbers a day's facts line states. Cities arrive already cut to as many as should be named. */
export type DayFacts = {
  cities: readonly string[];
  dayCount: number;
  stopCount: number;
  /** The author's public name, as the server resolved it ("Dana R."). */
  author: string;
  /** Null exactly when nobody has rated it. */
  rating: number | null;
  reviewCount: number;
};

/**
 * "Kyoto, Osaka · 3 days · 12 stops · by Dana R. · rated 4.6 from 12 reviews".
 * Pure. The day's preview card and its meta description print this one line.
 *
 * It is the page's own (`SharedDayScreen`'s meta line): a day count only past
 * one, and the stops counted over the whole sequence. A day with no cities
 * simply opens on its stops.
 */
export function dayFactsLine(facts: DayFacts): string {
  const parts: string[] = [];
  if (facts.cities.length > 0) parts.push(facts.cities.join(", "));
  if (facts.dayCount > 1) parts.push(`${facts.dayCount} days`);
  parts.push(plural(facts.stopCount, "stop"));
  parts.push(`by ${facts.author}`);
  // `DiscoverCard`'s `ratingLine` rule: keyed on the count, so a day nobody
  // has rated says nothing rather than "rated 0.0".
  //
  // **Words, not "★ 4.6 (12)"** (Mitchell, 2026-10-02, from a meta-tag
  // inspector): none of the card's bundled fonts carries U+2605, so satori drew
  // the star as a box, and a bare "(12)" did not say it counted reviews.
  if (facts.reviewCount > 0 && facts.rating !== null) {
    parts.push(`rated ${facts.rating.toFixed(1)} from ${plural(facts.reviewCount, "review")}`);
  }
  return parts.join(" · ");
}

/** A stop cut to what an arc sentence reads: its title, and its start when it has one. */
export type ArcStop = {
  title: string;
  timeWindow: { start: string } | null;
};

/**
 * A day's arc: the first stop of its morning, its midday and its evening, in
 * day order, titles deduped. A stop whose title is already picked for an
 * earlier bucket never fills a later one: the later bucket takes the next
 * distinct stop in it, so a repeated title wastes no bucket. Untimed stops
 * have no bucket, so a day with no timed stop arcs from its first stop
 * alone; a day with no stops arcs from nothing, and its caller falls back
 * to the facts line.
 */
export function dayArcHighlights(stops: readonly ArcStop[]): string[] {
  const timed = stops.filter((stop) => stop.timeWindow !== null);
  const picks: string[] = [];
  if (timed.length > 0) {
    const bucket = (start: string): number => {
      const hour = Number(start.slice(0, 2));
      return hour < 12 ? 0 : hour < 17 ? 1 : 2;
    };
    const first: (string | undefined)[] = [undefined, undefined, undefined];
    const picked = new Set<string>();
    for (const stop of timed) {
      const at = bucket(stop.timeWindow!.start);
      if (first[at] !== undefined) continue;
      const clean = withoutEmDash(stop.title.trim());
      if (clean === "" || picked.has(clean)) continue;
      first[at] = stop.title;
      picked.add(clean);
    }
    for (const title of first) if (title !== undefined) picks.push(title);
  } else if (stops.length > 0) {
    picks.push(stops[0]!.title);
  }
  const out: string[] = [];
  for (const title of picks) {
    const clean = withoutEmDash(title.trim());
    if (clean !== "" && !out.includes(clean)) out.push(clean);
  }
  return out;
}

/**
 * A day's description for a search result: the author's own summary, or the
 * arc sentence when there is none, or the facts line when the day has no
 * stops to arc from. The author's words are never rewritten: the arc only
 * fills the gap a missing summary leaves.
 */
export function dayDescription(summary: string | null, facts: DayFacts, stops?: readonly ArcStop[]): string {
  const own = summary?.trim() ?? "";
  if (own !== "") return own;
  const arc = stops === undefined ? [] : dayArcHighlights(stops);
  if (arc.length > 0) {
    const city = facts.cities[0];
    const where = city === undefined ? "" : ` in ${city}`;
    return `A day${where}: ${arc.join(", ")}, planned by someone who lived it. Borrow it for your trip.`;
  }
  return dayFactsLine(facts);
}

/**
 * Whether a day some reader may open belongs in a search index: published and
 * not hidden by an operator. Its author opens it either way, so "it rendered"
 * is not the test.
 */
export function dayIndexable(view: { day: { visibility: "public" | "private" }; moderation: object | null }): boolean {
  return view.day.visibility === "public" && view.moderation === null;
}

/** "1 stop", "12 stops": a count and its noun, with an "s" unless the count is one. */
export function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

// The list pages' titles and descriptions (SEO pass, 2026-10-24). Each page
// type's sentence is shaped by what the page is — a city goes deep on one
// day, a country ranges over cities, a theme ranges over places — never the
// same sentence with swapped words. A page features its OWN days (the first
// of the page's days, so paginated pages differ), and every sentence reads
// the searcher's words: "trips" and "days", not "playbooks", which is defined
// on-site but means nothing to a searcher yet.

/**
 * Generated copy never carries an em dash (Mitchell, 2026-10-24: they read
 * AI-coded and break the human-built feel). A stop title or day sentence
 * that has one reads with a comma instead; the words are untouched, only the
 * punctuation is normalized. The templates themselves never say "steal"
 * either: the site's word is "borrow". A quoted stop title passes through
 * verbatim apart from that punctuation: rewriting a user's title would
 * misquote their day, so the no-steal rule governs generated sentences,
 * not quoted titles.
 */
function withoutEmDash(text: string): string {
  return text
    .split("—")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .join(", ");
}

/**
 * A listed day, cut to what a title or description reads: its own sentence
 * (the server's "what kind of day", or null), its preview stops' titles, and
 * the cities it touches, in time order. The builders never see a database
 * row; a `DiscoverDay` already carries exactly these fields.
 */
export type SeoDay = {
  name: string;
  description: string | null;
  preview: readonly { title: string }[];
  cities: readonly string[];
};

/**
 * A day's hook: its first three preview stops' titles, in order, titles
 * deduped; its own sentence when it has no preview, its name when it has
 * neither. No times, no prices, no tags: the preview carries titles only, so
 * a hook never states either. Titles are cleaned before they are judged:
 * one that is only em dashes cleans to nothing, and falls through like a
 * missing title instead of emptying the hook.
 */
export function dayHook(day: SeoDay): string {
  const titles = [...new Set(day.preview.map((stop) => withoutEmDash(stop.title.trim())).filter((title) => title !== ""))];
  if (titles.length > 0) return titles.slice(0, 3).join(", ");
  const own = withoutEmDash(day.description?.trim() ?? "");
  if (own !== "") return own;
  return withoutEmDash(day.name);
}

/**
 * One place's hook on a breadth page: the first preview stop of its featured
 * day, falling back to the day's own sentence, then its name. A breadth page
 * names a place once, so one stop is the whole hook. Cleaned before judged,
 * as `dayHook`: a dash-only title falls through, it never empties the hook.
 */
export function placeHook(day: SeoDay): string {
  const first = day.preview.map((stop) => withoutEmDash(stop.title.trim())).find((title) => title !== "");
  if (first !== undefined) return first;
  const own = withoutEmDash(day.description?.trim() ?? "");
  if (own !== "") return own;
  return withoutEmDash(day.name);
}

/**
 * One featured day per distinct first city, in list order, up to `limit`: a
 * breadth page's hooks never repeat a place. A day with no city is skipped:
 * breadth is over places, and a placeless day names none.
 */
export function featuredByCity(days: readonly SeoDay[], limit: number): { city: string; day: SeoDay }[] {
  const seen = new Set<string>();
  const out: { city: string; day: SeoDay }[] = [];
  for (const day of days) {
    const city = day.cities[0];
    if (city === undefined || seen.has(city)) continue;
    seen.add(city);
    out.push({ city, day });
    if (out.length >= limit) break;
  }
  return out;
}

/** A city or country page's title base: the searcher's words, not the site's. */
export function placeTitle(name: string): string {
  return `${name} trips from real travelers`;
}

/** A country×city page's title base: the country anchor is what disambiguates the city. */
export function countryCityTitle(city: string, country: string): string {
  return `${city}, ${country}: trips from real travelers`;
}

/**
 * A tag page's title base. A global page borrows the theme ("Beach days
 * worth borrowing"); a scoped one names its place ("Beach days in Hvar").
 */
export function tagTitle(label: string, city: string | null, country: string | null): string {
  if (city !== null && country !== null) return `${label} days in ${city}, ${country}`;
  if (city !== null) return `${label} days in ${city}`;
  if (country !== null) return `${label} days in ${country}`;
  return `${label} days worth borrowing`;
}

/**
 * The count sentence the old copy used, kept for pages with no day to
 * feature. A page with no days 404s, so this is a builder's guard, not a
 * page's copy.
 */
function countSentence(total: number, where: string): string {
  return total === 1
    ? `1 day a traveler planned${where}. Open it and drop it into your trip.`
    : `${total} days other travelers planned${where}. Find one and drop it into your trip.`;
}

/**
 * A city page's description: deep on its featured day (the first of the
 * page's own days, so paginated pages differ), then the page's count.
 */
export function cityDescription(city: string, total: number, days: readonly SeoDay[]): string {
  const featured = days[0];
  if (featured === undefined) return countSentence(total, ` in ${city}`);
  return `${city}, from people who've been: ${dayHook(featured)}. ${plural(total, "day")} you can drop into your trip.`;
}

/**
 * A country page's description: breadth, one hook per city, up to three
 * cities. The cities are the page's own first days per city, so the sentence
 * names the places this page actually lists.
 */
export function countryDescription(country: string, total: number, days: readonly SeoDay[]): string {
  const places = featuredByCity(days, 3);
  if (places.length === 0) return countSentence(total, ` in ${country}`);
  const hooks = places.map(({ city, day }) => `${city}'s ${placeHook(day)}`).join(", ");
  return `${country} in real days: ${hooks}. Pick a day and drop it into your trip.`;
}

/**
 * A country×city page's description: deep on its featured day, like a city
 * page's, closing on borrowing rather than dropping. The country anchor
 * lives in the title, not the sentence: the page is one city's days.
 */
export function countryCityDescription(city: string, total: number, days: readonly SeoDay[]): string {
  const featured = days[0];
  if (featured === undefined) return countSentence(total, ` in ${city}`);
  return `${city}, from people who've been: ${dayHook(featured)}. ${plural(total, "day")} you can borrow for your trip.`;
}

/**
 * A tag page's description, shaped by its scope: a global page ranges over
 * places, a city page goes deep on one day, a country page names its places,
 * a city×country page goes deep with its country anchor. The theme reads
 * lowercased mid-sentence, as-is at the sentence's start.
 */
export function tagDescription(
  label: string,
  city: string | null,
  country: string | null,
  total: number,
  days: readonly SeoDay[],
): string {
  const theme = label.toLowerCase();
  const where =
    city !== null && country !== null ? ` in ${city}, ${country}` : city !== null ? ` in ${city}` : country !== null ? ` in ${country}` : "";
  const countFallback =
    total === 1
      ? `1 ${theme} day other travelers planned${where}. Open it and drop it into your trip.`
      : `${total} ${theme} days other travelers planned${where}. Find one and drop it into your trip.`;
  if (city !== null && country !== null) {
    const featured = days[0];
    if (featured === undefined) return countFallback;
    return `${city}, ${country} ${theme}: ${dayHook(featured)}. A real day, ready to drop into your trip.`;
  }
  if (city !== null) {
    const featured = days[0];
    if (featured === undefined) return countFallback;
    return `${city} ${theme}: ${dayHook(featured)}. A real day, ready to drop into your trip.`;
  }
  if (country !== null) {
    const places = featuredByCity(days, 3).map(({ city }) => city);
    if (places.length === 0) return countFallback;
    return `${country}'s ${theme}, from real trips: ${places.join(", ")}. ${label} days you can borrow.`;
  }
  const places = featuredByCity(days, 2);
  if (places.length === 0) return countFallback;
  const hooks = places.map(({ city, day }) => `${city}'s ${placeHook(day)}`).join(", ");
  return `${label} days from real trips: ${hooks}. Borrow one for your next trip.`;
}
