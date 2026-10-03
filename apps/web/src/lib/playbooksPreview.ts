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

/** What a day page's tab says when its card lookup misses. */
export const DAY_FALLBACK_TITLE = "A playbook";

/**
 * A day page's `<title>` from its card's og:title: the day's name, or the
 * fallback when the lookup failed or answered with the generic card (a
 * private, moderated or unknown day).
 */
export function dayTabTitle(ogTitle: unknown): string {
  return typeof ogTitle === "string" && ogTitle !== PLAYBOOKS_GENERIC.title ? ogTitle : DAY_FALLBACK_TITLE;
}
