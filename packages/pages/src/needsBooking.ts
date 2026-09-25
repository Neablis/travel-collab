import type { ActivityKind } from "@tc/contracts";

/** The one field the rule reads. Takes a shape, not a whole `ActivityView`, so
 *  callers can pass a projected stop or a hand-built one. */
export type BookableStop = { kind: ActivityKind };

/**
 * Whether a stop still needs booking: exactly the `pending` stops.
 *
 * **M28 (ADR-054, Mitchell 2026-09-25) made this one comparison.** `pending`
 * is the kind a person sets to say "not settled yet", so it is exactly the
 * outstanding work. `planned` is settled or needs nothing, and `transit` is the
 * movement between the things you book rather than one of them.
 *
 * It used to be a three-way rule over five kinds (Mitchell, 2026-08-29): never
 * `booked` or `transit`, always `hold` and `idea`, and `planned` only when
 * tagged `ticketed`. The `ticketed` exception existed because `booked` was
 * where a ticketed stop went once it was settled. With `booked` retired there
 * is nowhere for it to go, so the exception would have flagged every ticketed
 * stop forever. A ticketed stop that still needs a ticket is `pending`.
 *
 * One predicate, deliberately, because several surfaces show this count at
 * different zooms: the Calendar's per-city `N to book` flag, the home hero's
 * trip-wide "not booked" tile, and the notebook's "Still to book" widget
 * (`stop.rows{only: "needsBooking"}`). If they disagreed, a user would see a
 * day flagged on the Calendar that the hero had already counted as settled.
 *
 * **Why it lives in `@tc/pages`** (moved from `apps/web/src/lib` 2026-09-24,
 * M14 link 11). The widget resolver needs it, and `@tc/pages` depends only on
 * `@tc/contracts`, so the rule had to come down to where the resolver can see
 * it — one implementation, with `apps/web/src/lib/needsBooking.ts` re-exporting
 * it so no web caller changed. Not `@tc/contracts`: that package is Zod
 * schemas, and this is a product decision about those schemas' values, not a
 * shape crossing a boundary. `packages/fixtures/src/japan/verify.ts` still
 * keeps a mirror, because `@tc/fixtures` does not depend on this package.
 */
export function needsBooking(stop: BookableStop): boolean {
  return stop.kind === "pending";
}
