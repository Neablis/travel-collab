import type { SavedDay, TripCover } from "@tc/contracts";
import type { DiscoverResponse, PublicAuthor } from "@/lib/playbooks";
import { slugify } from "@/lib/playbookUrls";
import type { SharedDayView } from "@/lib/sharedDayView";
import { DISCOVER_RANK_TAG, LIBRARY_CACHE_SECONDS, LIBRARY_TAG, authorTag, dayTag, libraryCached } from "./libraryCache";
import { discoverFromSnapshot, publishedDaysFromSnapshot, type LibraryEntry } from "./librarySnapshot";
import * as live from "./playbooks";
import { getSavedDayCover } from "./savedDayCovers";
import { schedulePinBackfill } from "./savedDayPinBackfill";
import { readableSavedDayWithStanding } from "./savedDays";
import { sharedDayView, whatKindOfDay } from "./sharedDayView";

// The public library's reads, cached for a day (ADR-063). What the server
// pages and the sitemap read; the JSON API under `/api/playbooks` and
// `/api/saved-days` stays live, since the screens' own re-reads go there and
// it is rate-limited already.
//
// **Only what a reader who owns nothing sees is ever cached.** A signed-in
// reader's Discover, an author's own day, and a moderation note are read live
// every time. **A miss is never cached**: a private, moderated, deleted or
// unknown day is read again on every request, so random ids cannot fill the
// cache, and a private day and an unknown one stay the same answer (ADR-061).
//
// A list is tagged `library` and cleared by any change to which days are in
// it. A day is tagged by its id, and its author's numbers by the author.

/** One published day as a stranger reads it, and when it was read. */
type PublicDay = { day: SavedDay; publishedAt: string | null; cover: TripCover | null; readAt: number };

/** Thrown inside the cache for a day not in the library: `unstable_cache` keeps no throw. */
class NotInLibrary extends Error {}

async function readPublicDay(savedDayId: string): Promise<PublicDay> {
  // `publishedAt` off the row the read seam selects, as `sharedDayRead` takes it.
  const read = await readableSavedDayWithStanding(savedDayId, null);
  if (read === null) throw new NotInLibrary();
  const cover = await getSavedDayCover(savedDayId);
  return { day: read.day, publishedAt: read.publishedAt, cover, readAt: Date.now() };
}

// A day past its lifetime is read live, not served. Next answers an expired
// entry with the old value and refreshes it behind the response, and a refresh
// that throws keeps the old value. So a day that left the library by a path
// that cleared nothing (a content import, a hand-run UPDATE) would go on being
// shown until something cleared its tag, not for a day.
async function publicDay(savedDayId: string): Promise<PublicDay | null> {
  const read = () => readPublicDay(savedDayId);
  try {
    const cached = await libraryCached(["day", savedDayId], [dayTag(savedDayId)], read);
    return Date.now() - cached.readAt <= LIBRARY_CACHE_SECONDS * 1000 ? cached : await read();
  } catch (error) {
    if (error instanceof NotInLibrary) return null;
    throw error;
  }
}

/** An author's public numbers, as every library surface prints them. */
function publicAuthor(userId: string): Promise<PublicAuthor> {
  return libraryCached(["author", userId], [authorTag(userId)], () => live.publicAuthor(userId));
}

/**
 * The day page's read: the view `sharedDayView` would build for `readerId`,
 * or null for a 404.
 *
 * Cached unless the reader is its author. A day the library does not hold is
 * read live for a signed-in reader, since it may be their own private or
 * hidden day, and is null for anyone signed out. An author always reads live,
 * so they see their edits and an operator's note at once.
 */
export async function dayPageView(
  savedDayId: string,
  readerId: string | null,
): Promise<{ view: SharedDayView } | null> {
  const published = await publicDay(savedDayId);
  if (published === null || published.day.ownerId === readerId) {
    if (readerId === null) return null;
    const view = await sharedDayView(savedDayId, readerId);
    return view === null ? null : { view };
  }
  const { day, publishedAt, cover } = published;
  return {
    view: {
      day,
      isAuthor: false,
      author: await publicAuthor(day.ownerId),
      // Per reader, so outside the cache: it spends their geocode quota.
      pinning: readerId === null ? false : schedulePinBackfill(day, readerId),
      publishedAt,
      moderation: null,
      // In the day's cache entry, so a pick or a clear clears `dayTag` too.
      cover,
      // Listed: this path serves only days in the public library.
      ...whatKindOfDay(day.stops, true, await live.globalPageTags()),
    },
  };
}

// **A stranger's lists are worked out of one entry, not cached one per URL**
// (2026-11-22). Discover, and the place, tag, length and author pages, were
// each an entry per search, cursor and `?page=N`, and a crawler walking them
// found a key nobody had asked for almost every time: a database read for
// each, a few a minute through the night, so Neon never slept. The snapshot is
// every published day in one entry, and any of those URLs is a filter over it
// (`librarySnapshot.ts`), read once a day or after a list is cleared.

/**
 * The largest snapshot kept, measured as Next measures a data-cache entry: the
 * value as JSON, inside a JSON envelope. Next refuses an entry over 2 MB with
 * a warning and stores nothing, which would turn every list back into a read;
 * this leaves room for the envelope.
 */
export const SNAPSHOT_MAX_BYTES = 1_800_000;

/**
 * Every published day for the lists, or null when the library has outgrown
 * one cache entry and the lists fall back to an entry per URL.
 */
type LibrarySnapshot = { entries: LibraryEntry[] | null };

/** The library read whole, as the snapshot keeps it. */
async function readSnapshot(): Promise<LibrarySnapshot> {
  const entries = await live.readLibrarySnapshot();
  const bytes = JSON.stringify(JSON.stringify(entries)).length;
  if (bytes <= SNAPSHOT_MAX_BYTES) return { entries };
  // Kept as a small "too big" rather than thrown or left uncached, so the
  // fallback is decided once a day and not by a read per request.
  console.error("library snapshot too large to cache; lists read per URL", { bytes, days: entries.length });
  return { entries: null };
}

/**
 * The snapshot, under both list tags: publish and unpublish clear
 * `LIBRARY_TAG` and never the rank tag, so a day that left the library must
 * drop out through the first; the daily rank rewrite clears only the second.
 */
function librarySnapshot(): Promise<LibrarySnapshot> {
  return libraryCached(["snapshot"], [LIBRARY_TAG, DISCOVER_RANK_TAG], readSnapshot);
}

/** A stranger's Discover search, spelled field by field so one search is one key, whatever order the caller built it in. */
function strangersSearch(input: live.DiscoverInput): live.DiscoverInput & { after: string | null } {
  // Scope is Everyone for anyone signed out.
  const { cities, countries = [], sort, budget, length, rating = "any", tag = "any", after = null } = input;
  return { cities, countries, sort, budget, length, rating, tag, after, scope: "everyone" as const };
}

/**
 * Discover for one reader. A reader with no account is answered from the
 * snapshot; a signed-in one is read live, since *Yours* and *Saved* are theirs
 * alone.
 */
export async function discoverFor(input: live.DiscoverInput, readerId: string | null): Promise<DiscoverResponse> {
  if (readerId !== null) return live.discoverFor(input, readerId);
  const search = strangersSearch(input);
  const { entries } = await librarySnapshot();
  if (entries !== null) return discoverFromSnapshot(entries, { ...search, authorId: null }, search.after);
  return libraryCached(["discover", JSON.stringify(search)], [LIBRARY_TAG, DISCOVER_RANK_TAG], () =>
    live.discoverFor(search, null),
  );
}

/** Every place a published day touches: `playbooks.ts`'s `publishedPlaces`, cached. */
export function publishedPlaces(): Promise<live.PlacePage[]> {
  return libraryCached(["places"], [LIBRARY_TAG], live.publishedPlaces);
}

/** The page for one slug, or null when no published day touches it — which the route answers with a 404. */
export async function placeFor(kind: live.PlacePage["kind"], slug: string): Promise<live.PlacePage | null> {
  return (await publishedPlaces()).find((place) => place.kind === kind && place.slug === slug) ?? null;
}

/** Every country×city pair with a day on it: `playbooks.ts`'s `publishedCountryCityPages`, cached. */
export function publishedCountryCityPages(): Promise<live.CountryCityPage[]> {
  return libraryCached(["country-cities"], [LIBRARY_TAG], live.publishedCountryCityPages);
}

/** The country×city page for two slugs, or null when no published day matches the pair. */
export async function countryCityFor(countrySlug: string, citySlug: string): Promise<live.CountryCityPage | null> {
  return (
    (await publishedCountryCityPages()).find(
      (page) => page.country.slug === countrySlug && page.city.slug === citySlug,
    ) ?? null
  );
}

/** Every tag page with a day on it: `playbooks.ts`'s `publishedTagPages`, cached. */
export function publishedTagPages(): Promise<live.TagPage[]> {
  return libraryCached(["tags"], [LIBRARY_TAG], live.publishedTagPages);
}

/** The page for a tag, in one city's page, one country's page, one country×city pair, or the whole library, or null when no published day is named by it there. */
export async function tagPageFor(
  tag: live.TagPage["tag"],
  citySlug: string | null,
  countrySlug: string | null = null,
): Promise<live.TagPage | null> {
  return (
    (await publishedTagPages()).find(
      (page) => page.tag === tag && (page.city?.slug ?? null) === citySlug && (page.country?.slug ?? null) === countrySlug,
    ) ?? null
  );
}

/** Every length page with a day on it: `playbooks.ts`'s `publishedLengthPages`, cached. */
export function publishedLengthPages(): Promise<live.LengthPage[]> {
  return libraryCached(["lengths"], [LIBRARY_TAG], live.publishedLengthPages);
}

/** The page for a length band, in one city's page, one country's page, one country×city pair, or the whole library, or null when no published day falls in the band there. */
export async function lengthPageFor(
  band: live.LengthPage["band"],
  citySlug: string | null,
  countrySlug: string | null,
): Promise<live.LengthPage | null> {
  return (
    (await publishedLengthPages()).find(
      (page) =>
        page.band === band && (page.city?.slug ?? null) === citySlug && (page.country?.slug ?? null) === countrySlug,
    ) ?? null
  );
}

/** One page of a place's or an author's published days: `playbooks.ts`'s `publishedDaysPage`, from the snapshot. */
export async function publishedDaysPage(
  filter: Parameters<typeof live.publishedDaysPage>[0],
  page: Parameters<typeof live.publishedDaysPage>[1],
): ReturnType<typeof live.publishedDaysPage> {
  const { entries } = await librarySnapshot();
  if (entries !== null) return publishedDaysFromSnapshot(entries, filter, page);
  // The rank tag too: these pages list by `top`, which the daily rewrite moves.
  const tags =
    filter.authorId === undefined
      ? [LIBRARY_TAG, DISCOVER_RANK_TAG]
      : [LIBRARY_TAG, DISCOVER_RANK_TAG, authorTag(filter.authorId)];
  return libraryCached(["days", JSON.stringify(filter), JSON.stringify(page)], tags, () =>
    live.publishedDaysPage(filter, page),
  );
}

/** Published days in a city under every spelling its page merges ("São Paulo", "Sao Paulo"), or the one spelling when it has no page. */
export async function publishedDaysInCity(
  city: string,
  page: Parameters<typeof live.publishedDaysPage>[1],
): ReturnType<typeof live.publishedDaysPage> {
  const place = await placeFor("city", slugify(city));
  return publishedDaysPage({ cities: place?.cities ?? [city] }, page);
}

/** Every day a stranger can open, for the sitemap: `playbooks.ts`'s `sitemapDays`, cached. */
export function sitemapDays(): Promise<live.SitemapDay[]> {
  return libraryCached(["sitemap"], [LIBRARY_TAG], live.sitemapDays);
}
