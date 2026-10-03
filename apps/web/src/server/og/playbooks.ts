import { and, arrayContains, count, eq, isNull } from "drizzle-orm";
import { SavedDayVisibility } from "@tc/contracts";
import { countryName } from "@/lib/place";
import { countrySlug } from "@/lib/playbookUrls";
import { db } from "../db/client";
import { savedDays } from "../db/schema";
import { citiesKnownBy, publicAuthor, publicNamesOf } from "../playbooks";
import { ratingOf, readableSavedDay } from "../savedDays";

// The Playbooks link-preview lookups (spec 2026-10-02 §2.7). An unfurler has
// no session, so each one reads as a reader who owns nothing, and returns only
// what its card prints.
//
// **Names are the page's own.** A day and a profile name their author the way
// the library does everywhere — `publicNameFor`, "Dana R." or the handle
// (Mitchell, 2026-10-02; ADR-061 decision 4) — through the same server reads
// the pages use (`publicNamesOf`, `publicAuthor`), never `users.email`. So a
// preview cannot say more than the page under it.
//
// **Every miss is the generic card**, never a refusal of its own: a private,
// moderated, deleted or unknown day, an author with nothing shared, a city no
// published day touches. That keeps the routes from being an oracle for
// private days, and keeps a crafted `?city=` from printing arbitrary text on a
// Caesura-branded card.
//
// Not cached in Redis, unlike the invite and referral cards, nor in Next's
// data cache: these are a couple of indexed reads, run only on a CDN miss, and
// the CDN's day (`card.tsx`, purged by tag on publish; ADR-063) is what repeats.

/** How many cities a card names before it stops. */
export const CITIES_SHOWN = 3;

/** Longer than any city a stop can carry; a longer `?city=` is junk, not a lookup. */
const MAX_CITY_LENGTH = 200;

type Generic = { kind: "generic" };

/** What a shared day's card prints: its name, where and how long, the author's public name, its rating. */
export type PlaybookDayCard =
  | {
      kind: "day";
      name: string;
      cities: string[];
      dayCount: number;
      stopCount: number;
      author: string;
      /** Null exactly when nobody has rated it (`saved_days.rating`'s rule). */
      rating: number | null;
      reviewCount: number;
    }
  | Generic;

/** What a public profile's card prints: the author's public name and the profile's own numbers. */
export type PlaybookProfileCard =
  | { kind: "profile"; author: string; playbooksShared: number; adds: number; cities: string[] }
  | Generic;

/** What `/playbooks?city=` prints: the city as stored, and how many published days touch it. */
export type PlaybookCityCard = { kind: "city"; city: string; days: number } | Generic;

/** What a country page's card prints: its English name, and how many published days touch it. */
export type PlaybookCountryCard = { kind: "country"; country: string; days: number } | Generic;

/** The card for `/playbooks/day/<savedDayId>`: a published, unmoderated day, or the generic card. */
export async function dayCardFor(savedDayId: string): Promise<PlaybookDayCard> {
  // `null`: nobody's own day. What is left is published and not moderated,
  // the same predicate the page reads through, so the card exists exactly when
  // a signed-out reader could open the page.
  const day = await readableSavedDay(savedDayId, null);
  if (day === null) return { kind: "generic" };
  // Rating rides the row, not the `SavedDay` contract: the same read the day
  // page's structured data uses.
  const [{ rating, reviewCount }, nameOf] = await Promise.all([ratingOf(day.savedDayId), publicNamesOf([day.ownerId])]);
  return {
    kind: "day",
    name: day.name,
    cities: day.cities.slice(0, CITIES_SHOWN),
    dayCount: day.dayCount,
    stopCount: day.stops.length,
    author: nameOf(day.ownerId),
    rating,
    reviewCount,
  };
}

/** The card for `/playbooks/profile/<userId>`: someone who has shared a playbook, or the generic card. */
export async function profileCardFor(userId: string): Promise<PlaybookProfileCard> {
  // `publicAuthor` and `citiesKnownBy` already count published, undeleted,
  // unmoderated days only, which is what the profile page shows.
  const author = await publicAuthor(userId);
  // Nothing shared is the generic card, not "A traveler's playbooks": the id
  // is a URL segment a stranger typed, and `publicAuthor`'s own note says why
  // it must not come out as a plausible person.
  if (author.playbooksShared === 0) return { kind: "generic" };
  const cities = await citiesKnownBy(userId);
  return {
    kind: "profile",
    author: author.displayName,
    playbooksShared: author.playbooksShared,
    adds: author.adds,
    cities: cities.slice(0, CITIES_SHOWN).map((c) => c.city),
  };
}

/**
 * The card for `/playbooks?city=<city>`: how many published days touch it, or
 * the generic card when none does.
 *
 * **Matched exactly, as Discover matches** (`d.cities && ARRAY[...]` in
 * `server/playbooks.ts`). A case-folded match here would let `?city=kyoto`
 * promise days the page under it, which matches exactly, does not list. And
 * an exact match is what makes the printed city the stored spelling: a city
 * is only ever echoed when a published day already carries those letters.
 */
export async function cityCardFor(city: string): Promise<PlaybookCityCard> {
  if (city === "" || city.length > MAX_CITY_LENGTH) return { kind: "generic" };
  const days = await publishedDaysCarrying(savedDays.cities, city);
  return days === 0 ? { kind: "generic" } : { kind: "city", city, days };
}

/**
 * The card for `/playbooks/country/<slug>`, by ISO alpha-2 code: how many
 * published days touch that country, or the generic card when none does or the
 * code names no country. `cityCardFor`'s rule: nothing is printed that a
 * published day does not already carry.
 */
export async function countryCardFor(code: string): Promise<PlaybookCountryCard> {
  const upper = code.toUpperCase();
  // The place pages' own test, so a card never names a country that has no page.
  if (!/^[A-Z]{2}$/.test(upper) || countrySlug(upper) === null) return { kind: "generic" };
  const name = countryName(upper)!;
  const days = await publishedDaysCarrying(savedDays.countries, upper);
  return days === 0 ? { kind: "generic" } : { kind: "country", country: name, days };
}

// One count behind the city and the country card, so the two cannot disagree
// about which days a stranger could open.
async function publishedDaysCarrying(
  column: typeof savedDays.cities | typeof savedDays.countries,
  value: string,
): Promise<number> {
  const [row] = await db
    .select({ days: count() })
    .from(savedDays)
    .where(
      and(
        arrayContains(column, [value]),
        eq(savedDays.visibility, SavedDayVisibility.enum.public),
        isNull(savedDays.deletedAt),
        isNull(savedDays.moderatedAt),
      ),
    );
  return Number(row?.days ?? 0);
}

/** A route segment, decoded once; a malformed escape is kept as it came. */
export function segment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
