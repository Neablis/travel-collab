import { createHash } from "node:crypto";
import { dangerouslyDeleteByTag } from "@vercel/functions";
import { revalidateTag, unstable_cache } from "next/cache";
import { DATABASE_URL } from "./config";

// The public library is cached for a day (ADR-063; Mitchell, 2026-10-03: "We
// can probably cache a trip for 24h at least, they don't need to be live. And
// we can clear the cache when we publish or unpublish"). Two layers hold it,
// under one set of tag names: Next's data cache holds the reads
// (`publicLibrary.ts`), and Vercel's CDN holds the preview cards
// (`og/card.tsx`). Neither is Redis: ADR-059's free tier is budgeted per use,
// and both of these are already paid for.
//
// The cache is expendable in ADR-059's sense. Losing all of it costs a few
// database reads; what it must never do is go on showing a day that has left
// the library, which is why every writer that can take one out calls
// `invalidatePublicDay` after its commit.

/** How long a public read or a preview card is kept: a day. */
export const LIBRARY_CACHE_SECONDS = 86_400;

/** The tag on everything that lists days: Discover, place pages and their lists, the sitemap, related days. */
export const LIBRARY_TAG = "library";

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

// Production builds only. `next dev` and the test lanes read live, so a
// reseeded database or a test's own write is seen at once, and the cache's
// behaviour is proven where it runs: the e2e lane's `next start`.
/**
 * `read`, through Next's data cache for `LIBRARY_CACHE_SECONDS` under `key`
 * and `tags`. The value must survive JSON: strings for dates, no `undefined`
 * that matters. A throw is never cached, which is how a miss stays out.
 */
export function libraryCached<T>(key: readonly string[], tags: readonly string[], read: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== "production") return read();
  return unstable_cache(read, ["library", DATABASE_KEY, ...key], {
    revalidate: LIBRARY_CACHE_SECONDS,
    tags: [...tags],
  })();
}

// Awaited rather than handed to `waitUntil`: a 200 to "unpublish" should mean
// the day is gone, not that it will be shortly. It is one call, on a rare and
// author-initiated write. `dangerouslyDeleteByTag` and not `invalidateByTag`:
// invalidating serves the stale entry once more while it refreshes, and an
// unpublished or hidden day must not be shown again to anyone.
/**
 * Take one day, its author's numbers and every list out of both caches, after
 * a write that changed whether the day is in the library. Never throws: the
 * write has already committed, and a 500 now would tell its author it had not.
 */
export async function invalidatePublicDay(savedDayId: string, ownerId: string): Promise<void> {
  const tags = [dayTag(savedDayId), authorTag(ownerId), LIBRARY_TAG];
  if (process.env.NODE_ENV === "production") {
    try {
      // `{ expire: 0 }`: gone now. A profile such as "max" would serve the old
      // entry once while it refreshed.
      for (const tag of tags) revalidateTag(tag, { expire: 0 });
    } catch (error) {
      // Only outside a request, which no writer is in production.
      console.error("library cache: revalidateTag failed", { tags, error: String(error) });
    }
  }
  // The purge API exists only inside a Vercel function.
  if (!process.env.VERCEL) return;
  try {
    await dangerouslyDeleteByTag(tags);
  } catch (error) {
    console.error("library cache: CDN purge failed", { tags, error: String(error) });
  }
}

/** Vercel's limit on one cache tag, in UTF-8 bytes. */
const MAX_TAG_BYTES = 256;

/**
 * The `Vercel-Cache-Tag` header that lets `invalidatePublicDay` purge a CDN
 * response. A tag built from a typed URL segment can hold a comma, which
 * Vercel would read as two tags, or run past its length; those are left off.
 */
export function cacheTagHeader(...tags: string[]): Record<string, string> {
  const valid = tags.filter((tag) => tag !== "" && !tag.includes(",") && Buffer.byteLength(tag) <= MAX_TAG_BYTES);
  return valid.length === 0 ? {} : { "Vercel-Cache-Tag": valid.join(",") };
}
