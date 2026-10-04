import type { SavedDay } from "@tc/contracts";
import type { DiscoverResponse, PublicAuthor } from "@/lib/playbooks";
import { slugify } from "@/lib/playbookUrls";
import type { SharedDayView } from "@/lib/sharedDayView";
import { LIBRARY_CACHE_SECONDS, LIBRARY_TAG, authorTag, dayTag, libraryCached } from "./libraryCache";
import * as live from "./playbooks";
import { schedulePinBackfill } from "./savedDayPinBackfill";
import { publishedAtOf, readableSavedDay } from "./savedDays";
import { sharedDayView } from "./sharedDayView";

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
type PublicDay = { day: SavedDay; publishedAt: string | null; readAt: number };

/** Thrown inside the cache for a day not in the library: `unstable_cache` keeps no throw. */
class NotInLibrary extends Error {}

async function readPublicDay(savedDayId: string): Promise<PublicDay> {
  const day = await readableSavedDay(savedDayId, null);
  if (day === null) throw new NotInLibrary();
  return { day, publishedAt: await publishedAtOf(savedDayId), readAt: Date.now() };
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
  const { day, publishedAt } = published;
  return {
    view: {
      day,
      isAuthor: false,
      author: await publicAuthor(day.ownerId),
      // Per reader, so outside the cache: it spends their geocode quota.
      pinning: readerId === null ? false : schedulePinBackfill(day, readerId),
      publishedAt,
      moderation: null,
    },
  };
}

/**
 * Discover for one reader. A reader with no account is cached per search; a
 * signed-in one is read live, since *Yours* and *Saved* are theirs alone.
 */
export function discoverFor(input: live.DiscoverInput, readerId: string | null): Promise<DiscoverResponse> {
  if (readerId !== null) return live.discoverFor(input, readerId);
  // Spelled field by field so one search is one key, whatever order the
  // caller built it in. Scope is Everyone for anyone signed out.
  const { cities, countries = [], sort, budget, length, rating = "any" } = input;
  const search = { cities, countries, sort, budget, length, rating, scope: "everyone" as const };
  return libraryCached(["discover", JSON.stringify(search)], [LIBRARY_TAG], () => live.discoverFor(search, null));
}

/** Every place a published day touches: `playbooks.ts`'s `publishedPlaces`, cached. */
export function publishedPlaces(): Promise<live.PlacePage[]> {
  return libraryCached(["places"], [LIBRARY_TAG], live.publishedPlaces);
}

/** The page for one slug, or null when no published day touches it — which the route answers with a 404. */
export async function placeFor(kind: live.PlacePage["kind"], slug: string): Promise<live.PlacePage | null> {
  return (await publishedPlaces()).find((place) => place.kind === kind && place.slug === slug) ?? null;
}

/** One page of a place's or an author's published days: `playbooks.ts`'s `publishedDaysPage`, cached. */
export function publishedDaysPage(
  filter: Parameters<typeof live.publishedDaysPage>[0],
  page: Parameters<typeof live.publishedDaysPage>[1],
): ReturnType<typeof live.publishedDaysPage> {
  const tags = filter.authorId === undefined ? [LIBRARY_TAG] : [LIBRARY_TAG, authorTag(filter.authorId)];
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
