import type { ApiResult } from "@/lib/apiClient";

/**
 * A read-through cache for the typed API client: in-flight de-duplication plus
 * a short reuse window, keyed by `queryKeys.ts`.
 *
 * **Why this exists.** Nothing in this app refetches on window focus and there
 * is no polling and no socket, so a repeated request is always a REMOUNT: the
 * lens switcher unmounts the lens it leaves (`TripBoardScreen`'s
 * `{view === "Overview" && <OverviewLens/>}`), so a round trip to Calendar and
 * back re-ran `/globals`, `/pages` and `/pages/:id` for data that could not
 * have changed in the second you were away. Navigating home → trip refetched
 * the same `TripDetail` the home page's hero had just read.
 *
 * **Why it is a window and not a store.** The flip side of "no realtime" is
 * that refetch-on-mount is the ONLY way this product ever shows you a
 * co-traveller's edit. A long-lived cache would buy request count with
 * correctness on the one flow the product is named after. So the windows are
 * short (see `DEDUPE`) and every local write invalidates — the cache suppresses
 * the thrash, never the next real read.
 *
 * **Why it is not in `apiClient.ts`.** The helpers there stay pure fetchers,
 * uncached, which is what makes them usable as an SWR `fetcher` verbatim. The
 * caching decision belongs to the call site that knows how fresh it needs to
 * be, the way `useSWR(key, fetcher, { dedupingInterval })` does. Keeping it out
 * of the client also keeps `apiClient.test.ts`'s totality suite honest: that
 * suite drives each helper twice with different mocked outcomes, and a helper
 * that had quietly cached the first one would pass while testing nothing.
 *
 * **There is deliberately no window for search.** City search was the third
 * target when this module was written and it is the one that came back out: a
 * cached query cannot fail, and `/api/cities`' four reachable states (results,
 * no matches, loading, failed) are a milestone exit gate. Saving the request
 * and keeping the failure state reachable are mutually exclusive on that
 * endpoint — a background revalidation would keep the state and save nothing.
 * The cost it was aimed at is real and belongs on the server. See ADR-046's
 * Consequences and KI-2026-09-14-a.
 *
 * ADR-046 records the decision and the migration.
 */

export type CacheKey = string;

/**
 * How long a resolved read may be reused, by kind of data. Named rather than
 * inlined because the number IS the freshness policy, and a bare `30_000` at a
 * call site is a policy nobody can review.
 */
export const DEDUPE = {
  /**
   * One navigation round trip. Long enough to cover leaving a route and coming
   * back, short enough that a co-traveller's edit is at most this stale. This
   * is the window for `TripDetail`, the one document two people edit at once.
   */
  NAVIGATION: 5_000,
  /**
   * Trip documents that are read far more than they are written — the notebook
   * list, a page's content, the globals projection. Every local write to the
   * trip invalidates them, so this window only ever hides a REMOTE write.
   */
  DOCUMENT: 30_000,
} as const;

type Entry = {
  /** Only ever an `ok: true` result — see `cachedRead`. */
  result: ApiResult<unknown>;
  storedAt: number;
};

/** A read on the wire, tagged so a later one can tell whether it is still its own. */
type Pending = { token: number; promise: Promise<ApiResult<unknown>> };

const entries = new Map<CacheKey, Entry>();
const inFlight = new Map<CacheKey, Pending>();

/**
 * One monotonic clock for the whole cache. Every read takes a ticket from it;
 * every invalidation and every clear stamps itself with one.
 *
 * This is the same shape as `(app)/page.tsx`'s `loadTicket`, and it is here for
 * a race that ticket does not cover: a read already on the wire when a write
 * lands. Without it, `dispatch(command)` → (the in-flight `GET /api/trips/:id`
 * resolves) would STORE the pre-command trip, and the next mount inside the
 * window would serve it — a board that silently reverts the edit you just made.
 * The read still returns its stale value to the caller that asked for it (it
 * asked before the write, and TripProvider reconciles from the command's own
 * response anyway); it just may not be CACHED.
 *
 * **It never resets, and that is the point** (CodeRabbit, PR #175). This was a
 * per-key counter that `clearQueryCache` cleared along with everything else —
 * so a read that started before the clear had captured `0`, compared equal to a
 * freshly-cleared `0`, and repopulated the cache it had just been flushed out
 * of. `resetDemoData` is the live caller, and it deletes every trip the account
 * has: a deleted trip came straight back. A clock that only ever goes up cannot
 * have that bug, because a ticket taken before a stamp is always below it.
 */
let clock = 0;

/** When each key was last invalidated, by clock ticket. */
const invalidatedAt = new Map<CacheKey, number>();

/** When the whole cache was last cleared, by clock ticket. */
let clearedAt = 0;

/**
 * May a read that took ticket `token` still store its result under `key`?
 *
 * No if the key was invalidated, or the cache cleared, after it started.
 */
function mayStore(key: CacheKey, token: number): boolean {
  return (invalidatedAt.get(key) ?? 0) < token && clearedAt < token;
}

export type CachedReadOptions = {
  /** Reuse a stored result younger than this. Defaults to `DEDUPE.NAVIGATION`. */
  dedupeMs?: number;
};

/**
 * Read through the cache.
 *
 * Three outcomes, in order: a stored result inside the window is returned as
 * is; an identical read already in flight is joined rather than duplicated;
 * otherwise the read runs and its result is stored **if it succeeded**.
 *
 * **Failures are never stored.** A cached `ok: false` would make a retry a
 * no-op for the rest of the window — the user presses Try again and nothing
 * happens, which is a worse failure than the one it caches. Failures still
 * de-duplicate while in flight, which is the half that is safe.
 *
 * **This helper resolves and never rejects**, upholding the invariant
 * `apiClient.ts` and `pagesClient.ts` both state at the top of the file. The
 * catch below should be unreachable through those helpers; it is kept for the
 * reason `TripProvider.load`'s is — the cost of being wrong about that is a
 * caller's `.then` that never runs, and a spinner with no error and no retry.
 */
export function cachedRead<T>(
  key: CacheKey,
  read: () => Promise<ApiResult<T>>,
  { dedupeMs = DEDUPE.NAVIGATION }: CachedReadOptions = {},
): Promise<ApiResult<T>> {
  const hit = entries.get(key);
  if (hit !== undefined && Date.now() - hit.storedAt < dedupeMs) {
    return Promise.resolve(hit.result as ApiResult<T>);
  }

  // Only a read that is still current may be joined. `invalidate` and
  // `clearQueryCache` DETACH the requests they supersede (rather than merely
  // marking them), so what is left here is never pre-write.
  const pending = inFlight.get(key);
  if (pending !== undefined) return pending.promise as Promise<ApiResult<T>>;

  const token = ++clock;
  const request = (async (): Promise<ApiResult<T>> => {
    try {
      const result = await read();
      // The clock check is what makes a write during this read win.
      if (result.ok && mayStore(key, token)) {
        entries.set(key, { result, storedAt: Date.now() });
      }
      return result;
    } catch (err) {
      return {
        ok: false,
        error: { status: 0, message: err instanceof Error ? err.message : "Network error" },
      };
    } finally {
      // Only if this slot is still OURS. A detached request finishing late must
      // not evict the newer read that replaced it, or that newer read's
      // followers would each start a duplicate request.
      if (inFlight.get(key)?.token === token) inFlight.delete(key);
    }
  })();

  inFlight.set(key, { token, promise: request as Promise<ApiResult<unknown>> });
  return request;
}

/**
 * Drop everything cached under `prefix`, and stop any read already in flight
 * under it from being stored.
 *
 * Call it after a successful write, with the widest prefix the write could
 * have moved — `tripKeys.all(tripId)` for a planning command or a page edit.
 * The keys are built so a prefix names a family; see `queryKeys.ts`.
 */
export function invalidate(prefix: string): void {
  const at = ++clock;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
  // A COPY of the keys: the loop deletes from the map it is walking.
  for (const key of [...inFlight.keys()]) {
    if (!key.startsWith(prefix)) continue;
    invalidatedAt.set(key, at);
    // DETACHED, not just stamped (CodeRabbit, PR #175). Stamping alone stopped
    // the pre-write read from being stored but left its promise here to be
    // JOINED — so the next read after the write got the pre-write answer handed
    // straight to it, without the cache being consulted at all. The request
    // still resolves for whoever already awaits it; it is simply no longer the
    // answer anyone new receives.
    inFlight.delete(key);
  }
}

/**
 * Empty the cache completely. For tests.
 *
 * **Deliberately not wired to sign-out**, which is the first thing to check of
 * any module-level cache holding another account's trips. It does not need to
 * be: `signOut({ callbackUrl: "/welcome" })` in `AccountMenu` ends in a
 * `window.location.href` assignment — a full document load, which takes this
 * module's Maps with it. The cache outlives a client-side route change, which
 * is the whole point, and cannot outlive a sign-out.
 */
export function clearQueryCache(): void {
  // Stamp BEFORE emptying, and never reset `clock` — see its comment. Every
  // read already on the wire holds a ticket below this stamp, so none of them
  // can store.
  clearedAt = ++clock;
  entries.clear();
  inFlight.clear();
  invalidatedAt.clear();
}
