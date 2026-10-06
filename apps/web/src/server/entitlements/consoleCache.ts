import { cacheScope } from "@/server/libraryCache";

// **The operator console's one cached read** (M36 follow-up; Mitchell,
// 2026-10-06: "use leverage cache, it's a admin dashboard, a delay is fine").
//
// Since M36 part 7 the Users tab pages, searches and filters on the server, so
// every pill, Next and pause in typing is a navigation — and each one re-read
// the whole trailing window: every account's 30 days priced
// (`costPerAccount`, ~240 ms at 20k turns) plus every active grant, only to
// learn the underwater ids and one column. Those two reads are the same for
// every click, so they are kept here for `CONSOLE_CACHE_SECONDS`. What a page
// of rows shows about *its* accounts — plan, grants, Asked, Last active — is
// still read live per page (`accountRows`).
//
// Next's data cache, as the public library uses (`libraryCache.ts`): not
// Redis, and keyed by the same database and deployment (`cacheScope`).
// Production builds only, so `next dev` and the unit and integration lanes read
// live.

// `next/cache` imported where used, as `libraryCache.ts` explains.
const nextCache = () => import("next/cache");

/** How long the console's trailing reads are kept: five minutes. A delay is fine on an admin surface. */
export const CONSOLE_CACHE_SECONDS = 300;

/** The tag on everything the console caches. */
export const CONSOLE_TAG = "admin-console";

/**
 * `read`, through Next's data cache for `CONSOLE_CACHE_SECONDS` under `key`.
 * The value must survive JSON. A throw is never cached.
 */
export async function consoleCached<T>(key: readonly string[], read: () => Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== "production") return read();
  const { unstable_cache } = await nextCache();
  return unstable_cache(read, ["admin-console", ...cacheScope(), ...key], {
    revalidate: CONSOLE_CACHE_SECONDS,
    tags: [CONSOLE_TAG],
  })();
}

/**
 * Drop the console's cached reads, after an operator's own write that changes
 * them — a grant or a revoke moves the grant holders, and so who is underwater.
 * The operator should see their own change on the next page, not five minutes
 * later. Never throws: the write has already committed.
 */
export async function invalidateConsole(): Promise<void> {
  if (process.env.NODE_ENV !== "production") return;
  try {
    const { revalidateTag } = await nextCache();
    revalidateTag(CONSOLE_TAG, { expire: 0 });
  } catch (error) {
    console.error("admin-console cache: revalidateTag failed", { tag: CONSOLE_TAG, error: String(error) });
  }
}
