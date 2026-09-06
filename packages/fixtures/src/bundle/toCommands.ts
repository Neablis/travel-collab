// A bundle trip becomes `TripCommand[]` — never a projection row.
//
// Same rule and same reason as `japan/commands.ts`: the app is event-sourced,
// so seeded content has to be "the commands a real user's actions would have
// produced" (AGENTS.md invariant 1). Nothing here talks to a database or an
// API; wiring these into the command pipeline is the importer's job.

import type { TripCommand } from "@tc/contracts";
import type { BundleStop, BundleTrip } from "./schema.ts";
import { bundleId } from "./ids.ts";

/** Mints a fresh uuid. Injectable so a test can be deterministic. */
export type MintId = () => string;

/** Calendar-date arithmetic in UTC, so it cannot drift across a local offset. */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export type TripCommandOptions = {
  /**
   * The trip's own id. Defaulted from the bundle id and the trip's key, so
   * re-importing the same bundle addresses the same trip instead of creating a
   * second one.
   */
  tripId?: string;
  /**
   * Today, `YYYY-MM-DD`, for resolving `startsInDays`. Passed in, never read
   * off the clock — this package is imported by a bundled route and every other
   * fixture module here is pure for the same reason (invariant 4).
   */
  today: string;
  mintId?: MintId;
};

function addActivity(
  tripId: string,
  activityId: string,
  stop: BundleStop,
  dayId: string | undefined,
): TripCommand {
  return {
    type: "AddActivity",
    tripId,
    activityId,
    ...(dayId ? { dayId } : {}),
    title: stop.title,
    ...(stop.timeWindow ? { timeWindow: stop.timeWindow } : {}),
    ...(stop.location ? { location: stop.location } : {}),
    kind: stop.kind ?? "planned",
    ...(stop.tags && stop.tags.length > 0 ? { tags: stop.tags } : {}),
    ...(stop.anchors && stop.anchors.length > 0 ? { anchors: stop.anchors } : {}),
    ...(stop.cost ? { cost: stop.cost } : {}),
    ...(stop.notes ? { notes: stop.notes } : {}),
  };
}

/** The trip's id, derived from the bundle it came in and its own key. */
export function tripIdFor(bundleId_: string, tripKey: string): string {
  return bundleId(`trip:${bundleId_}`, tripKey);
}

/** The trip's first day, resolved from whichever of the two date forms it carries. */
export function tripStartDate(trip: BundleTrip, today: string): string {
  return trip.startDate ?? addDays(today, trip.startsInDays ?? 0);
}

/**
 * The commands that build one bundle trip, GROUPED the way they should be sent.
 *
 * Grouping is not the caller's private business — one batch is one History
 * entry, and a whole trip in one batch leaves the History popover showing a
 * single entry with two hundred semicolon-joined clauses. `japanTripCommandGroups`
 * makes the same split for the same reason, and this is that shape generalised:
 *
 *   [0]      the trip's dates, currency and budget
 *   [1..n]   one group per day
 *   [n+1]    the backlog, when there is one
 *
 * `CreateTrip` is NOT here: a trip's genesis mints its id, and the importer
 * either sends it or lets `POST /api/trips` do it. Every command below is a
 * `BatchableCommand`.
 *
 * No `MoveActivity` follow-up is needed to get each day's order right:
 * `ActivityAdded` appends to the end of the target day's `activityIds`
 * (`packages/domain/src/trip/evolve.ts`), so iterating a day's stops in written
 * order reproduces that order exactly.
 */
export function bundleTripCommandGroups(
  bundleKey: string,
  trip: BundleTrip,
  options: TripCommandOptions,
): TripCommand[][] {
  const { today, mintId = () => crypto.randomUUID() } = options;
  const tripId = options.tripId ?? tripIdFor(bundleKey, trip.key);
  const startDate = tripStartDate(trip, today);
  const dayIds = trip.days.map(() => mintId());

  const setup: TripCommand[] = [
    {
      type: "SetTripDates",
      tripId,
      startDate,
      endDate: addDays(startDate, Math.max(trip.days.length - 1, 0)),
      newDayIds: dayIds,
    },
  ];
  // Currency BEFORE budget: `SetTripBudget` carries its own currency and the
  // domain refuses a same-value `SetTripCurrency` as a no-op, so a USD trip
  // must not send one at all. Only a trip that says something other than the
  // domain's default gets the command.
  if (trip.currency && trip.currency !== "USD") {
    setup.push({ type: "SetTripCurrency", tripId, currency: trip.currency });
  }
  if (trip.budget) {
    setup.push({ type: "SetTripBudget", tripId, budget: trip.budget });
  }

  const days = trip.days.map((day, i) =>
    day.stops.map((stop) => addActivity(tripId, mintId(), stop, dayIds[i]!)),
  );

  // No dayId — `AddActivity`'s documented "omitted = backlog".
  const backlog = trip.backlog.map((stop) => addActivity(tripId, mintId(), stop, undefined));

  return [setup, ...days, ...(backlog.length > 0 ? [backlog] : [])];
}

/**
 * `AddActivity` for each loose stop in a bundle's `activities`, landing in
 * `tripId`'s backlog.
 *
 * One group, because that is how a wishlist arrives — the same shape the Japan
 * fixture gives its four parked ideas, and one readable History entry rather
 * than N.
 */
export function bundleActivityCommands(
  tripId: string,
  stops: BundleStop[],
  mintId: MintId = () => crypto.randomUUID(),
): TripCommand[] {
  return stops.map((stop) => addActivity(tripId, mintId(), stop, undefined));
}

/** The same commands, flat. Use the grouped form when the History popover matters. */
export function bundleTripCommands(
  bundleKey: string,
  trip: BundleTrip,
  options: TripCommandOptions,
): TripCommand[] {
  return bundleTripCommandGroups(bundleKey, trip, options).flat();
}
