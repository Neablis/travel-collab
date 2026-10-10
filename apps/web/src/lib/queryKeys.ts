/**
 * The cache-key catalogue for client reads.
 *
 * Every key this app caches under is built here and nowhere else, for one
 * reason: a cache is only as good as an invalidation you can find. A key
 * spelled inline at the read site and spelled again — slightly differently —
 * at the write site is the classic way a cache goes quietly stale, and it is
 * not a bug any type checker catches.
 *
 * **These are also the SWR keys.** `useSWR(tripKeys.detail(id), () =>
 * fetchTripDetail(id))` is the whole migration for a call site; nothing in
 * this file changes when that happens. That is deliberate — see ADR-046.
 *
 * Keys are `:`-delimited strings, narrowest last, so a prefix names a family:
 * `invalidate(tripKeys.all(id))` drops the detail, the globals, the notebook
 * list and every page doc of that trip in one call. Trip ids are uuids, so a
 * trip's prefix cannot accidentally match another trip's key; the trailing
 * colon on `all()` makes that true by construction rather than by luck.
 */

export const tripKeys = {
  /**
   * The prefix covering everything cached about one trip. This is the argument
   * to `invalidate` after any write to the trip — a command, a page edit, a
   * page delete. Prefer it to invalidating one narrow key: a command can move
   * the notebook (the assistant inserts a playbook day) and a page write can
   * move the globals, so "this trip changed" is the honest granularity.
   */
  all: (tripId: string) => `trip:${tripId}:`,
  detail: (tripId: string) => `trip:${tripId}:detail`,
  history: (tripId: string) => `trip:${tripId}:history`,
  access: (tripId: string) => `trip:${tripId}:access`,
  globals: (tripId: string) => `trip:${tripId}:globals`,
  weather: (tripId: string) => `trip:${tripId}:weather`,
  pages: (tripId: string) => `trip:${tripId}:pages`,
  page: (tripId: string, pageId: string) => `trip:${tripId}:page:${pageId}`,
} as const;

/**
 * A trip's cover photo (M37), deliberately **outside** `tripKeys.all`'s family.
 * A cover is trip metadata with its own routes, not a command (M37 D1), so no
 * planning command or page edit can move it — and under `trip:<id>:` every
 * stop added would drop it, and Trip settings would draw its skeleton again on
 * the next open for a photo that had not changed. Its own writes invalidate it
 * (`CoverSection`).
 */
export const coverKeys = {
  trip: (tripId: string) => `cover:trip:${tripId}`,
} as const;
