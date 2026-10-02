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
 * Pure. The day's preview card, its meta description and its structured data
 * all print this one line.
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

/** A day's description for a search result: the author's own summary, or the facts line when there is none. */
export function dayDescription(summary: string | null, facts: DayFacts): string {
  const own = summary?.trim() ?? "";
  return own === "" ? dayFactsLine(facts) : own;
}

/**
 * Whether a day some reader may open belongs in a search index: published and
 * not hidden by an operator. Its author opens it either way, so "it rendered"
 * is not the test.
 */
export function dayIndexable(view: { day: { visibility: "public" | "private" }; moderation: object | null }): boolean {
  return view.day.visibility === "public" && view.moderation === null;
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
