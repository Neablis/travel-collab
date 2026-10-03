// The public library's URLs, built and read in one place (SEO pass, D7). Pure,
// so the server pages, the client link builders and the sitemap share it.
//
// A day's URL is `/playbooks/day/<slug>-<uuid>`. The slug is DERIVED from the
// day's name on every build and stored nowhere; the uuid alone resolves the
// day. A link whose slug is missing or stale still opens: the page redirects
// it to the current URL.

import { countryName } from "./place";
import { DISCOVER_PAGE_SIZE } from "./playbooks";

const MAX_SLUG_LENGTH = 60;
const UUID_AT_END = /(?:^|-)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// Latin letters NFKD does not decompose, spelled the way the place spells
// them in ASCII. Without this "Wrocław" slugged to "wroc-aw", and a city's
// URL has no redirect behind it to survive a later fix (review of #299).
const LATIN_LETTERS: Record<string, string> = {
  ł: "l", ø: "o", đ: "d", ð: "d", ß: "ss", þ: "th", æ: "ae", œ: "oe", ı: "i", ħ: "h", ŧ: "t", ŋ: "ng",
};
const LATIN_LETTER = new RegExp(`[${Object.keys(LATIN_LETTERS).join("")}]`, "g");

/** Lowercase ASCII words joined by hyphens, at most 60 characters; empty when the text has none. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(LATIN_LETTER, (letter) => LATIN_LETTERS[letter]!)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, "");
}

/** A day's route segment: `<slug>-<uuid>`, or the bare uuid when its name has no slug. */
export function daySegment(day: { savedDayId: string; name: string }): string {
  const slug = slugify(day.name);
  return slug === "" ? day.savedDayId : `${slug}-${day.savedDayId}`;
}

/** A day's canonical path, `/playbooks/day/<slug>-<uuid>`. */
export function dayPath(day: { savedDayId: string; name: string }): string {
  return `/playbooks/day/${daySegment(day)}`;
}

/** The uuid at the end of a day segment (lowercased), or null; and whatever slug came before it. */
export function parseDaySegment(segment: string): { id: string | null; slug: string } {
  const match = UUID_AT_END.exec(segment);
  if (match === null) return { id: null, slug: "" };
  const id = match[1]!.toLowerCase();
  return { id, slug: segment.slice(0, segment.length - id.length).replace(/-$/, "") };
}

/**
 * How many published days a city or country page needs before it is indexed
 * and listed in the sitemap. Below it the page still opens and is
 * `noindex, follow`. Production on 2026-10-02: 318 cities over 155 days, 293 of
 * them with one day — a one-day list is a thin page that duplicates its day.
 */
export const MIN_INDEXED_PLACE_DAYS = 3;

// The sitemap and the page's robots tag both ask this, about the same
// `PlacePage.days`: two thresholds, or one threshold over two counts, would let
// a place be listed in the sitemap and `noindex` on arrival.
/** Whether a city or country page is indexed and listed in the sitemap. */
export function placeIndexable(place: { days: number }): boolean {
  return place.days >= MIN_INDEXED_PLACE_DAYS;
}

/** Days per city or country page — Discover's own page size, not a second 24. */
export const PLACE_PAGE_SIZE = DISCOVER_PAGE_SIZE;

/** A city or country page's path, page one: `/playbooks/<kind>/<slug>`. */
export function placePath(place: { kind: "city" | "country"; slug: string }): string {
  return `/playbooks/${place.kind}/${place.slug}`;
}

/** `/playbooks/city/<slug>`, or null for a city whose name has no slug (link to Discover's `?city=` instead). */
export function cityPath(city: string): string | null {
  const slug = slugify(city);
  return slug === "" ? null : `/playbooks/city/${slug}`;
}

/**
 * A country's slug, from the English name of its ISO alpha-2 code; null when
 * the code has no name. `countryName` hands an unmappable code back unchanged
 * ("??", "XX"), and a code is not a name.
 */
export function countrySlug(code: string): string | null {
  const name = countryName(code);
  if (name === null || name === code) return null;
  const slug = slugify(name);
  return slug === "" ? null : slug;
}

/** A place page's URL for page `page`; page one is the bare path, so it is self-canonical. */
export function placePagePath(path: string, page: number): string {
  return page <= 1 ? path : `${path}?page=${page}`;
}
