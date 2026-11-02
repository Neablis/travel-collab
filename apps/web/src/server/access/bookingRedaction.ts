import type { Booking, TripRole } from "@tc/contracts";
import { roleAtLeast } from "../accessPolicy";

/**
 * **The one rule for who sees a booking's code** (M44, ADR-086 decision 2): a
 * confirmation number and a manage-link are a credential, so editors and
 * owners read the whole booking and every other reader gets `{ provider }`.
 * `null` is a reader with no seat on the trip (a share link, a stranger's
 * clone), who is held to the same floor as a viewer.
 *
 * Returns a mapper so a caller redacts a whole trip with one role lookup. A
 * booking with no provider is nothing once the code is gone, so it becomes
 * `null`, never `{}` (the decider's own rule for an empty booking).
 */
export function redactBookingFor(role: TripRole | null) {
  const full = role !== null && roleAtLeast(role, "editor");
  return <B extends Booking | null | undefined>(booking: B): B => {
    if (full || booking === null || booking === undefined) return booking;
    return (booking.provider === undefined ? null : { provider: booking.provider }) as B;
  };
}

/** A copy of `activities` with every booking redacted for `role`; the same object when nothing needs redacting. */
export function redactActivitiesFor<A extends { booking?: Booking | null }>(
  role: TripRole | null,
  activities: Record<string, A>,
): Record<string, A> {
  if (role !== null && roleAtLeast(role, "editor")) return activities;
  const redact = redactBookingFor(role);
  return Object.fromEntries(
    Object.entries(activities).map(([id, a]) => [id, a.booking ? { ...a, booking: redact(a.booking) } : a]),
  );
}
