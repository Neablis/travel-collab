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
  /**
   * A public, slowly-changing index with no per-user content. City search
   * aggregates published days; a five-minute-old count is not a wrong answer.
   * Matches the `max-age` the route sends, so the two layers agree.
   */
  SEARCH: 300_000,
} as const;

type Entry = {
  /** Only ever an `ok: true` result — see `cachedRead`. */
  result: ApiResult<unknown>;
  storedAt: number;
};

const entries = new Map<CacheKey, Entry>();
const inFlight = new Map<CacheKey, Promise<ApiResult<unknown>>>();

/**
 * Per-key write counter, bumped by `invalidate`.
 *
 * This is the same monotonic-ticket shape as `(app)/page.tsx`'s `loadTicket`,
 * and it is here for a race that ticket does not cover: a read already on the
 * wire when a write lands. Without it, `dispatch(command)` → (the in-flight
 * `GET /api/trips/:id` resolves) would STORE the pre-command trip, and the
 * next mount inside the window would serve it — a board that silently reverts
 * the edit you just made. The read still returns its stale value to the caller
 * that asked for it (it asked before the write, and TripProvider reconciles
 * from the command's own response anyway); it just may not be cached.
 */
const generation = new Map<CacheKey, number>();

function generationOf(key: CacheKey): number {
  return generation.get(key) ?? 0;
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

  const pending = inFlight.get(key);
  if (pending !== undefined) return pending as Promise<ApiResult<T>>;

  const startedAt = generationOf(key);
  const request = (async (): Promise<ApiResult<T>> => {
    try {
      const result = await read();
      // The generation check is what makes a write during this read win.
      if (result.ok && generationOf(key) === startedAt) {
        entries.set(key, { result, storedAt: Date.now() });
      }
      return result;
    } catch (err) {
      return {
        ok: false,
        error: { status: 0, message: err instanceof Error ? err.message : "Network error" },
      };
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request as Promise<ApiResult<unknown>>);
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
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
  for (const key of inFlight.keys()) {
    if (key.startsWith(prefix)) generation.set(key, generationOf(key) + 1);
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
  entries.clear();
  inFlight.clear();
  generation.clear();
}
