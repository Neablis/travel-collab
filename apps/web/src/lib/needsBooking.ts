import type { ActivityKind, ActivityTag } from "@tc/contracts";

/** The two fields the rule reads. Takes a shape, not a whole `ActivityView`, so
 *  callers can pass a projected stop or a hand-built one. */
export type BookableStop = { kind: ActivityKind; tags: ActivityTag[] };

/**
 * Whether a stop still needs booking.
 *
 * SPEC §12 words this as "every stop whose kind is neither `booked` nor
 * `transit`". **Taken literally that flagged 50 of the Japan fixture's 72
 * stops** — because `planned` is the contract's zero value, so every coffee,
 * every free shrine and every browse through a record shop counted as work
 * outstanding. A number that large on every single day is not an actionable
 * flag; it is wallpaper, and SPEC §12 calls this "the one actionable thing at
 * this zoom".
 *
 * The rule below, decided by Mitchell 2026-08-29, is narrower and is a recorded
 * delta from SPEC §12 (see KI-77, and KI-52 for the same shape of decision):
 *
 * - `booked` and `transit` — never. A settled thing, and a travel leg is the
 *   movement between the things you book rather than one of them.
 * - `hold` and `idea` — always. These are the kinds a user sets *deliberately*
 *   to say "not settled yet", so they are exactly the outstanding work.
 * - `planned` — only when tagged `ticketed`. `planned` is the default a stop
 *   gets for free, so treating it as "unbooked" reads intent into the absence
 *   of intent. The exception uses the tag's own designed power, from the
 *   handoff's `TAGS` table: *"Ticketed — Wants a booking date. The assistant
 *   keeps asking until there is one."* An unbooked ticketed museum is the one
 *   `planned` stop that genuinely owes you an action.
 *
 * One predicate, deliberately, because two surfaces show this count at
 * different zooms: the Calendar's per-city `N to book` flag and the home hero's
 * trip-wide "not booked" tile. If they disagreed, a user would see a day
 * flagged on the Calendar that the hero had already counted as settled.
 */
export function needsBooking(stop: BookableStop): boolean {
  if (stop.kind === "booked" || stop.kind === "transit") return false;
  if (stop.kind === "planned") return stop.tags.includes("ticketed");
  return true;
}
