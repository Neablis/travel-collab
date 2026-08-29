import type { ActivityKind } from "@tc/contracts";

/**
 * Whether a stop counts toward "to book" — SPEC §12: "every stop whose kind is
 * neither `booked` nor `transit`."
 *
 * One predicate, deliberately, because two surfaces show this count at
 * different zooms: the Calendar's per-city `N to book` flag and the home hero's
 * trip-wide "not booked" tile. If they disagreed, a user would see a day flagged
 * on the Calendar that the hero had already counted as settled, and the only
 * honest reading of that is "one of these is broken".
 *
 * `transit` is excluded rather than counted because a travel leg is not
 * something you book from this app's point of view — it is the movement between
 * the things you do book. `planned`, the default, IS counted: a stop nobody has
 * said anything about is exactly the stop that still needs a decision.
 */
export function needsBooking(kind: ActivityKind): boolean {
  return kind !== "booked" && kind !== "transit";
}
