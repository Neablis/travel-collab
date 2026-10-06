import { createHash } from "node:crypto";
import { dangerouslyDeleteByTag, waitUntil } from "@vercel/functions";
import { DATABASE_URL } from "./config";

// `next/cache` is imported where it is used, never at the top. `savedDays.ts`
// and `reports.ts` import this module, and `scripts/import-content-production.ts`
// loads those under plain node, where `next/cache` has no entry an ESM
// resolver can find (`scripts/__tests__/strip-only-entry-points.test.mjs`).
// Both uses sit behind `NODE_ENV === "production"`, which no script runs under.
const nextCache = () => import("next/cache");

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

// And by the deployment that wrote them. `unstable_cache` keys on the
// callback's source and these parts, and Vercel's data cache outlives a
// deploy: a release that changed the shape of `SavedDay`, `DiscoverDay` or
// `PublicAuthor` would otherwise read the last release's JSON for a day. The
// cost is a cold cache on every deploy. Read per call, not at import, so it is
// the running deployment's id. Off Vercel there is one build per database in
// the test lanes, which `DATABASE_KEY` already separates.
const deploymentKey = (): string =>
  process.env.VERCEL_DEPLOYMENT_ID || process.env.VERCEL_GIT_COMMIT_SHA || "local";

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
  return clear([...tags, LIBRARY_TAG], "await");
}

// Awaited, for the unpublish's reason: the library names people (ADR-061
// decision 4), and someone who changed the name it shows, perhaps to take
// their real one out, should not see the old one on the next page.
/**
 * Take an author's numbers and every list out of both caches, after the name
 * the library shows for them may have changed. Never throws.
 */
export function invalidateAuthor(userId: string): Promise<void> {
  return clear([authorTag(userId), LIBRARY_TAG], "await");
}

// Not `library`: an add moves the day's count and its author's, and no list
// needs to show it within the day. What it buys is a reader seeing their own
// add when they go back to the day (M11b's "1 trip"). The CDN half is not
// awaited: adds are frequent, and the reader's own next page is a data-cache
// read, whose expiry Next flushes with this response.
/**
 * Take one day's read and its author's numbers out of both caches, after an
 * add of that day counted. Never throws, and never waits on the CDN.
 */
export function invalidateDayRead(savedDayId: string, ownerId: string): Promise<void> {
  return clear([dayTag(savedDayId), authorTag(ownerId)], "after");
}

/** How long a CDN purge may run before it is abandoned. */
export const PURGE_TIMEOUT_MS = 2_000;

// The two halves land at different times on Vercel. `revalidateTag` only
// records the tags; Next flushes them after the response, through `waitUntil`
// (the app-route template), so the data cache expires just after the 200 and
// not before it. The CDN purge is the half that can be awaited, and is for a
// change in what the library holds: a 200 to "unpublish" then means its card is
// gone. It is bounded by PURGE_TIMEOUT_MS so a purge that never answers cannot
// hang the write. The narrow race the flush leaves, a read that queried before
// the commit and stores its entry after the flush, re-caches the old answer;
// for a day that is bounded by `readAt` (`publicLibrary.ts`), for a list by its
// day. `dangerouslyDeleteByTag` and not `invalidateByTag`: invalidating serves
// the stale entry once more while it refreshes.
async function clear(tags: string[], purge: "await" | "after"): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    try {
      const { revalidateTag } = await nextCache();
      // `{ expire: 0 }`: gone now. A profile such as "max" would serve the old
      // entry once while it refreshed.
      for (const tag of tags) revalidateTag(tag, { expire: 0 });
    } catch (error) {
      // It throws outside a request, during a render, and inside
      // `unstable_cache` or "use cache"; no writer calls it from any of those.
      console.error("library cache: revalidateTag failed", { tags, error: String(error) });
    }
  }
  // The purge API exists only inside a Vercel function.
  if (!process.env.VERCEL) return;
  const purged = boundedPurge(tags);
  if (purge === "await") await purged;
  else waitUntil(purged);
}

/** The CDN purge, abandoned after PURGE_TIMEOUT_MS. Never rejects. */
async function boundedPurge(tags: string[]): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`no answer in ${PURGE_TIMEOUT_MS}ms`)), PURGE_TIMEOUT_MS);
  });
  try {
    await Promise.race([dangerouslyDeleteByTag(tags), timeout]);
  } catch (error) {
    console.error("library cache: CDN purge failed", { tags, error: String(error) });
  } finally {
    clearTimeout(timer);
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
