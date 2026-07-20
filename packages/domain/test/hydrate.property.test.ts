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
const activity: fc.Arbitrary<ActivityState> = fc.record({
  title: fc.string({ minLength: 1, maxLength: 40 }),
  timeWindow: fc.constant(null),
  location: fc.constant(null),
  notes: fc.option(fc.string(), { nil: null }),
  anchors: fc.constant([]),
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
