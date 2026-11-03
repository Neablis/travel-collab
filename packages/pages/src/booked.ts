import type { ActivityView } from "@tc/contracts";
import { needsBooking } from "./needsBooking";

/** The one field the rule reads; a shape, like `BookableStop`, so a hand-built stop will do. */
export type BookedStop = Pick<ActivityView, "booking">;

/**
 * Whether a stop has been booked: it carries a booking, whatever is in it.
 *
 * Non-null, not "has a confirmation". A reader below editor gets
 * `{ provider: null }` (the server strips the code, ADR-086 decision 2), and
 * that must still count, or the Booked list would be shorter for a viewer than
 * for the owner. Independent of `needsBooking` on purpose: that is a statement
 * about `kind`, this about the booking, and a stop can be both (a pending hold
 * with a reference) or neither.
 */
export const isBooked = ({ booking }: BookedStop): boolean => booking !== null;

/**
 * Whether a stop passes `stop.rows`' `only` filter. The table and a repeat over
 * the same params both ask this, so they cannot disagree on which stops are in.
 */
export const passesOnly = (only: "needsBooking" | "booked" | undefined, activity: ActivityView): boolean =>
  only === "needsBooking" ? needsBooking(activity) : only === "booked" ? isBooked(activity) : true;
