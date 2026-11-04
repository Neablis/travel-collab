import type { TripRole } from "@tc/contracts";
import { roleAtLeast } from "../accessPolicy";

/** A booking as a read serves it: `provider` is null on a redacted code-only booking. */
type ReadBooking = { confirmation?: string; provider?: string | null; url?: string };

/**
 * **The one rule for who sees a booking's code** (M44, ADR-086 decision 2): a
 * confirmation number and a manage-link are a credential, so editors and
 * owners read the whole booking and every other reader gets `{ provider }`.
 * `null` is a reader with no seat on the trip (a share link, a stranger's
 * clone), who is held to the same floor as a viewer.
 *
 * Returns a mapper so a caller redacts a whole trip with one role lookup. A
 * booking with no provider becomes `{ provider: null }`, not `null`: a reader
 * still learns the stop is booked, as the assistant's `booked` says, without
 * the code.
 */
export function redactBookingFor(role: TripRole | null) {
  const full = role !== null && roleAtLeast(role, "editor");
  return <B extends ReadBooking | null | undefined>(booking: B): B => {
    if (full || booking === null || booking === undefined) return booking;
    return { provider: booking.provider ?? null } as B;
  };
}

/** A copy of `activities` with every booking redacted for `role`; the same object when nothing needs redacting. */
export function redactActivitiesFor<A extends { booking?: ReadBooking | null }>(
  role: TripRole | null,
  activities: Record<string, A>,
): Record<string, A> {
  if (role !== null && roleAtLeast(role, "editor")) return activities;
  const redact = redactBookingFor(role);
  return Object.fromEntries(
    Object.entries(activities).map(([id, a]) => [id, a.booking ? { ...a, booking: redact(a.booking) } : a]),
  );
}

/**
 * `events` with the booking in every `ActivityAdded` and `ActivityUpdated`
 * payload redacted for `role`: those two carry the whole stop snapshot, and the
 * events poll serves them raw to a viewer. Other events carry no booking.
 */
export function redactEventsFor<E extends { type: string; payload: unknown }>(
  role: TripRole | null,
  events: readonly E[],
): E[] {
  if (role !== null && roleAtLeast(role, "editor")) return [...events];
  const redact = redactBookingFor(role);
  return events.map((e) => {
    if (e.type !== "ActivityAdded" && e.type !== "ActivityUpdated") return e;
    const payload = e.payload as { booking?: ReadBooking | null };
    return payload.booking ? { ...e, payload: { ...payload, booking: redact(payload.booking) } } : e;
  });
}

/** A detail with its stops' bookings redacted for `role`; the same object when nothing needs redacting. */
export function redactDetailFor<D extends { activities: Record<string, { booking?: ReadBooking | null }> }>(
  role: TripRole | null,
  detail: D,
): D {
  const activities = redactActivitiesFor(role, detail.activities);
  return activities === detail.activities ? detail : { ...detail, activities };
}
