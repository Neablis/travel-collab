import { createHash } from "node:crypto";
import { DATABASE_URL } from "./config";
import { deploymentVersion } from "@/lib/deployment/env";

// `next/cache` is imported where it is used, never at the top. `savedDays.ts`
// and `reports.ts` import this module, and `scripts/import-content-production.ts`
// loads those under plain node, where `next/cache` has no entry an ESM
// resolver can find (`scripts/__tests__/strip-only-entry-points.test.mjs`).
// Both uses sit behind `NODE_ENV === "production"`, which no script runs under.
const nextCache = () => import("next/cache");

// The public library is cached for a day (ADR-063; Mitchell, 2026-10-03: "We
// can probably cache a trip for 24h at least, they don't need to be live. And
// we can clear the cache when we publish or unpublish"). Next's data cache
// holds the reads (`publicLibrary.ts`), under tag names a writer clears. It is
// not Redis: ADR-059's free tier is budgeted per use, and this is already paid
// for. The preview cards (`og/card.tsx`) carry the same tags in a header, which
// a CDN in front of the app may honour; the app itself purges none (M59: there
// is no CDN API behind it).
//
// The cache is expendable in ADR-059's sense. Losing all of it costs a few
// database reads; what it must never do is go on showing a day that has left
// the library, which is why every writer that can take one out calls
// `invalidatePublicDay` after its commit.

/** How long a public read or a preview card is kept: a day. */
export const LIBRARY_CACHE_SECONDS = 86_400;

/** The tag on everything that lists days: Discover, place pages and their lists, the sitemap, related days. */
export const LIBRARY_TAG = "library";

/**
 * The tag on Discover's ranked (signed-out) page. The hourly rank rewrite
 * clears it and nothing else: it moves the order, not any day's content.
 */
export const DISCOVER_RANK_TAG = "discover-rank";

/** The tag on one day's cached read and on its preview card. */
export const dayTag = (savedDayId: string): string => `day:${savedDayId}`;

/** The tag on an author's public numbers, their same-author list and their profile card. */
export const authorTag = (userId: string): string => `author:${userId}`;

// Entries are keyed by the database they were read from as well as by their
// arguments. CI restores `apps/web/.next/cache` between runs, the data cache
// lives inside it (`fetch-cache`), and every test run reads a database of its
// own (`scripts/with-test-db.mjs`): keyed by arguments alone, Discover for a
// signed-out visitor would answer one run with another run's days for a day.
const DATABASE_KEY = createHash("sha256").update(DATABASE_URL).digest("hex").slice(0, 16);

// And by the deployment that wrote them. `unstable_cache` keys on the
// callback's source and these parts, and the data cache outlives a
// deploy: a release that changed the shape of `SavedDay`, `DiscoverDay` or
// `PublicAuthor` would otherwise read the last release's JSON for a day. The
// cost is a cold cache on every deploy. Read per call, not at import, so it is
// the running deployment's id. Where none is set there is one build per
// database in the test lanes, which `DATABASE_KEY` already separates.
const deploymentKey = (): string => deploymentVersion();

/**
 * The key parts every data-cache entry in this app starts with: the database
 * it was read from and the deployment that wrote it, for the reasons above.
 * Shared so another cache (the operator console's) cannot key differently.
 */
export const cacheScope = (): string[] => [DATABASE_KEY, deploymentKey()];

// Production builds only. `next dev` and the test lanes read live, so a
// reseeded database or a test's own write is seen at once, and the cache's
// behaviour is proven where it runs: the e2e lane's `next start`.
/**
 * `read`, through Next's data cache for `LIBRARY_CACHE_SECONDS` under `key`
 * and `tags`. The value must survive JSON: strings for dates, no `undefined`
 * that matters. A throw is never cached, which is how a miss stays out.
 */
export async function libraryCached<T>(
  key: readonly string[],
  tags: readonly string[],
  read: () => Promise<T>,
): Promise<T> {
  if (process.env.NODE_ENV !== "production") return read();
  const { unstable_cache } = await nextCache();
  return unstable_cache(read, ["library", ...cacheScope(), ...key], {
    revalidate: LIBRARY_CACHE_SECONDS,
    tags: [...tags],
  })();
}

/**
 * Take one day, its author's numbers and every list out of both caches, after
 * a write that changed whether the day is in the library. Never throws: the
 * write has already committed, and a 500 now would tell its author it had not.
 */
export function invalidatePublicDay(savedDayId: string, ownerId: string): Promise<void> {
  return invalidatePublicDays([{ savedDayId, ownerId }]);
}

/**
 * `invalidatePublicDay` for many days at once, with each tag cleared once:
 * what a seed route that rewrites a library owes it.
 */
export function invalidatePublicDays(days: readonly { savedDayId: string; ownerId: string }[]): Promise<void> {
  if (days.length === 0) return Promise.resolve();
  const tags = new Set<string>();
  for (const { savedDayId, ownerId } of days) tags.add(dayTag(savedDayId)).add(authorTag(ownerId));
  return clear([...tags, LIBRARY_TAG]);
}

/**
 * Take the ranked Discover page out of the cache, after `saved_day_ranks` was
 * rewritten. Throws, unlike the other invalidators: its one caller is the cron,
 * which has no author to mislead and should fail loudly, not report a success
 * while the page keeps the old order for a day.
 */
export function invalidateDiscoverRank(): Promise<void> {
  return clearOrThrow([DISCOVER_RANK_TAG]);
}

// The library names people (ADR-061 decision 4), and someone who changed the
// name it shows, perhaps to take their real one out, should not see the old one
// on the next page.
/**
 * Take an author's numbers and every list out of the cache, after the name the
 * library shows for them may have changed. Never throws.
 */
export function invalidateAuthor(userId: string): Promise<void> {
  return clear([authorTag(userId), LIBRARY_TAG]);
}

// Not `library`: an add moves the day's count and its author's, and no list
// needs to show it within the day. What it buys is a reader seeing their own
// add when they go back to the day (M11b's "1 trip").
/**
 * Take one day's read and its author's numbers out of the cache, after an add
 * of that day counted. Never throws.
 */
export function invalidateDayRead(savedDayId: string, ownerId: string): Promise<void> {
  return clear([dayTag(savedDayId), authorTag(ownerId)]);
}

// `revalidateTag` records the tags, and Next flushes them after the response,
// so the data cache expires just after the 200 and not before it. The narrow
// race that leaves, a read that queried before the commit and stores its entry
// after the flush, re-caches the old answer; for a day that is bounded by
// `readAt` (`publicLibrary.ts`), for a list by its day. Still async, and still
// returned by every writer's `await`, so the signature does not change if a
// purge is ever put back.
async function clearOrThrow(tags: string[]): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  const { revalidateTag } = await nextCache();
  // `{ expire: 0 }`: gone now. A profile such as "max" would serve the old
  // entry once while it refreshed.
  for (const tag of tags) revalidateTag(tag, { expire: 0 });
}

// Every writer's clear: the write has committed, so a failure is logged.
async function clear(tags: string[]): Promise<void> {
  try {
    await clearOrThrow(tags);
  } catch (error) {
    // It throws outside a request, during a render, and inside
    // `unstable_cache` or "use cache"; no writer calls it from any of those.
    console.error("library cache: revalidateTag failed", { tags, error: String(error) });
  }
}

/** Vercel's limit on one cache tag, in UTF-8 bytes. */
const MAX_TAG_BYTES = 256;

/**
 * The `Vercel-Cache-Tag` header. Nothing purges a CDN now (M59: none fronts
 * the app), so it is inert here; it is kept because it is harmless (author ids
 * are already public in `/playbooks/[copy]/profile/[userId]`) and a CDN put in
 * front later would honour it. A tag built from a typed URL segment can hold a comma, which
 * Vercel would read as two tags, or run past its length; those are left off.
 */
export function cacheTagHeader(...tags: string[]): Record<string, string> {
  const valid = tags.filter((tag) => tag !== "" && !tag.includes(",") && Buffer.byteLength(tag) <= MAX_TAG_BYTES);
  return valid.length === 0 ? {} : { "Vercel-Cache-Tag": valid.join(",") };
}
