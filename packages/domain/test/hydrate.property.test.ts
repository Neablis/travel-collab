import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hydrate, tripDetailFromState, tripStatesEqual, type TripState, type ActivityState } from "../src";

// RISK GATE: validates the plan's central assumption that TripDetail is a
// lossless superset of TripState, i.e. hydrate is a true inverse of
// tripDetailFromState. See docs/specs/2026-07-07-foundation-design.md.

const uuid = fc.uuid({ version: 4 });
const money = fc.record({
  amountMinor: fc.integer({ min: 0, max: 1_000_000 }),
  currency: fc.constantFrom("USD", "EUR", "GBP"),
});

const pad2 = (n: number) => String(n).padStart(2, "0");

// Two distinct hour/minute pairs, ordered start < end, formatted as HH:MM.
const timeWindow: fc.Arbitrary<{ start: string; end: string }> = fc
  .tuple(
    fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })),
    fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 })),
  )
  .filter(([[h1, m1], [h2, m2]]) => h1 * 60 + m1 !== h2 * 60 + m2)
  .map(([a, b]) => {
    const [aH, aM] = a;
    const [bH, bM] = b;
    const [first, second] = aH * 60 + aM < bH * 60 + bM ? [a, b] : [b, a];
    return { start: `${pad2(first[0])}:${pad2(first[1])}`, end: `${pad2(second[0])}:${pad2(second[1])}` };
  });

// lat/lng must be provided together (both present or both absent).
const location = fc
  .record({
    name: fc.string({ minLength: 1, maxLength: 30 }),
    coords: fc.option(
      fc.record({
        lat: fc.float({ min: -90, max: 90, noNaN: true }),
        lng: fc.float({ min: -180, max: 180, noNaN: true }),
      }),
      { nil: null },
    ),
    countryCode: fc.option(fc.constantFrom("US", "FR", "JP", "CA"), { nil: null }),
  })
  .map(({ name, coords, countryCode }) => ({
    name,
    ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    ...(countryCode ? { countryCode } : {}),
  }));

const weekday = fc.constantFrom("mon", "tue", "wed", "thu", "fri", "sat", "sun");

const anchor = fc.oneof(
  fc.record({ kind: fc.constant("dayOfWeek" as const), days: fc.uniqueArray(weekday, { minLength: 1, maxLength: 3 }) }),
  fc.record({ kind: fc.constant("timeOfDay" as const), window: timeWindow }),
);

const activity: fc.Arbitrary<ActivityState> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 40 }),
  timeWindow: fc.option(timeWindow, { nil: null }),
  location: fc.option(location, { nil: null }),
  notes: fc.option(fc.string(), { nil: null }),
  anchors: fc.array(anchor, { maxLength: 3 }),
  kind: fc.constantFrom("planned", "booked", "hold", "idea", "transit"),
  tags: fc.uniqueArray(fc.constantFrom("meal", "lodging", "ticketed", "outdoors"), { maxLength: 3 }),
  cost: fc.option(money, { nil: null }),
});

// Structurally valid TripState: activity ids partitioned across days + backlog.
const arbTripState: fc.Arbitrary<TripState> = fc
  .record({
    tripId: uuid,
    name: fc.string({ minLength: 1, maxLength: 40 }),
    createdBy: uuid,
    startDate: fc.option(fc.constant("2027-06-01"), { nil: null }),
    dayIds: fc.uniqueArray(uuid, { maxLength: 4 }),
    activityIds: fc.uniqueArray(uuid, { maxLength: 6 }),
    currency: fc.constantFrom("USD", "EUR", "GBP"),
    budget: fc.option(money, { nil: null }),
    dismissed: fc.uniqueArray(fc.string({ minLength: 1 }), { maxLength: 3 }),
    status: fc.constantFrom("active" as const, "deleted" as const),
  })
  .chain((s) =>
    fc
      .tuple(
        // assign each activity to a day index [0..dayIds.length] (last = backlog)
        fc.array(fc.nat({ max: s.dayIds.length }), {
          minLength: s.activityIds.length,
          maxLength: s.activityIds.length,
        }),
        fc.array(activity, { minLength: s.activityIds.length, maxLength: s.activityIds.length }),
      )
      .map(([assign, activities]): TripState => {
        const days = s.dayIds.map((dayId) => ({ dayId, activityIds: [] as string[] }));
        const backlog: string[] = [];
        s.activityIds.forEach((id, i) => {
          const slot = assign[i]!;
          if (slot < days.length) days[slot]!.activityIds.push(id);
          else backlog.push(id);
        });
        return {
          tripId: s.tripId,
          name: s.name,
          members: [{ userId: s.createdBy, role: "owner" }],
          startDate: s.startDate,
          days,
          backlog,
          activities: Object.fromEntries(s.activityIds.map((id, i) => [id, activities[i]!])),
          dismissedConflictIds: [...s.dismissed].sort(),
          currency: s.currency,
          budget: s.budget,
          status: s.status,
        };
      }),
  );

describe("hydrate", () => {
  it("is the inverse of tripDetailFromState (round-trip)", () => {
    fc.assert(
      fc.property(arbTripState, (state) => {
        const roundTripped = hydrate(tripDetailFromState(state, "2027-01-01T00:00:00.000Z"));
        expect(tripStatesEqual(roundTripped, state)).toBe(true);
      }),
    );
  });
});
