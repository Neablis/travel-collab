// The public library's URLs, built and read in one place (SEO pass, D7). Pure,
// so the server pages, the client link builders and the sitemap share it.
//
// A day's URL is `/playbooks/day/<slug>-<uuid>`. The slug is DERIVED from the
// day's name on every build and stored nowhere; the uuid alone resolves the
// day. A link whose slug is missing or stale still opens: the page redirects
// it to the current URL.

import type { ActivityTag, ActivityTagDescribed } from "@tc/contracts";
import { countryFacts } from "@tc/pages";
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
/** Whether a city, country or tag page is indexed and listed in the sitemap (M42 D10 holds tags to it too). */
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

// The assigned ISO codes `@tc/pages`' country table leaves out on purpose: it
// holds travel facts, and these have no one to state them for. They are still
// countries a day can stop in, so they still get a page.
const UNINHABITED_ISO_CODES: ReadonlySet<string> = new Set(["AQ", "BV", "GS", "HM", "IO", "TF"]);

/**
 * A country's slug, from the English name of its ISO alpha-2 code; null when
 * the code is not a country. `countryName` hands an unmappable code back
 * unchanged ("??", "XX"), and `Intl` also names regions that are not countries
 * ("ZZ" is "Unknown Region", "EU", "UN") and retired codes ("UK", "SU"), so a
 * code must be an assigned one: the country table, which keeps "XK" (Kosovo),
 * or one of the uninhabited codes it omits.
 */
export function countrySlug(code: string): string | null {
  if (countryFacts(code) === undefined && !UNINHABITED_ISO_CODES.has(code.toUpperCase())) return null;
  const name = countryName(code);
  if (name === null || name === code) return null;
  const slug = slugify(name);
  return slug === "" ? null : slug;
}

// The tag's key, never its label: ADR-070 never renames a key and may relabel
// one (`meal` reads Food), and a URL has no redirect behind it to survive that.
/**
 * A tag page's path, page one: `/playbooks/tag/<tag>` for the whole library,
 * `/playbooks/city/<slug>/<tag>` for that tag in one city's page, and the
 * country forms of both — `/playbooks/country/<slug>/<tag>`, and
 * `/playbooks/country/<country>/city/<city>/<tag>` for a city inside its
 * country. One convention throughout: singular `tag`, the tag bare under its
 * place, and a `/city/` segment only where the country scope needs it to tell
 * a city slug from a tag.
 */
export function tagPath(
  tag: ActivityTagDescribed,
  citySlug: string | null = null,
  countryPageSlug: string | null = null,
): string {
  if (countryPageSlug !== null && citySlug !== null)
    return `/playbooks/country/${countryPageSlug}/city/${citySlug}/${tag}`;
  if (countryPageSlug !== null) return `/playbooks/country/${countryPageSlug}/${tag}`;
  return citySlug === null ? `/playbooks/tag/${tag}` : `/playbooks/city/${citySlug}/${tag}`;
}

/** A country×city page's path, page one: `/playbooks/country/<country>/city/<city>`. */
export function countryCityPath(countryPageSlug: string, citySlug: string): string {
  return `/playbooks/country/${countryPageSlug}/city/${citySlug}`;
}

/**
 * Where a day's tag chip leads: its tag's page when the day's description
 * names the tag, so the day is on that page (ADR-070 §4); null otherwise. A
 * day of meals with one bar carries a Nightlife chip, and the Nightlife page
 * does not list it, or does not exist.
 */
export function namedTagPath(named: readonly ActivityTagDescribed[]): (tag: ActivityTag) => string | null {
  return (tag) => {
    const page = named.find((name) => name === tag);
    return page === undefined ? null : tagPath(page);
  };
}

/** A place page's URL for page `page`; page one is the bare path, so it is self-canonical. */
export function placePagePath(path: string, page: number): string {
  return page <= 1 ? path : `${path}?page=${page}`;
}
