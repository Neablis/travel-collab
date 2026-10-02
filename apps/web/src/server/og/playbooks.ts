import { and, arrayContains, count, eq, isNull } from "drizzle-orm";
import { SavedDayVisibility } from "@tc/contracts";
import { db } from "../db/client";
import { savedDays } from "../db/schema";
import { citiesKnownBy, publicAuthor, publicNamesOf } from "../playbooks";
import { readableSavedDay } from "../savedDays";

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
// Not cached in Redis, unlike the invite and referral cards: these are a
// couple of indexed reads, and the CDN's hour (`card.tsx`) is what repeats.

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

/** The card for `/playbooks/day/<savedDayId>`: a published, unmoderated day, or the generic card. */
export async function dayCardFor(savedDayId: string): Promise<PlaybookDayCard> {
  // `null`: nobody's own day. What is left is published and not moderated,
  // the same predicate the page reads through, so the card exists exactly when
  // a signed-out reader could open the page.
  const day = await readableSavedDay(savedDayId, null);
  if (day === null) return { kind: "generic" };
  // Rating rides the row, not the `SavedDay` contract. `readableSavedDay`
  // already proved the id is a readable uuid.
  const [[row], nameOf] = await Promise.all([
    db
      .select({ rating: savedDays.rating, reviewCount: savedDays.reviewCount })
      .from(savedDays)
      .where(eq(savedDays.id, day.savedDayId)),
    publicNamesOf([day.ownerId]),
  ]);
  return {
    kind: "day",
    name: day.name,
    cities: day.cities.slice(0, CITIES_SHOWN),
    dayCount: day.dayCount,
    stopCount: day.stops.length,
    author: nameOf(day.ownerId),
    rating: row?.rating ?? null,
    reviewCount: row?.reviewCount ?? 0,
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
  const [row] = await db
    .select({ days: count() })
    .from(savedDays)
    .where(
      and(
        arrayContains(savedDays.cities, [city]),
        eq(savedDays.visibility, SavedDayVisibility.enum.public),
        isNull(savedDays.deletedAt),
        isNull(savedDays.moderatedAt),
      ),
    );
  const days = Number(row?.days ?? 0);
  return days === 0 ? { kind: "generic" } : { kind: "city", city, days };
}

/** A route segment, decoded once; a malformed escape is kept as it came. */
export function segment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
