import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { witness } from "./support/witness";
import type { TripMember, TripRole } from "@tc/contracts";
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

// A non-owner member is unreachable by replay — no command adds a member, so
// only a TripCreated `owner` is ever minted (M11 link 2). It is generated here
// directly, because hydrate/tripDetailFromState must already be lossless for
// one by the time invites (link 3) start producing them; the first member is
// always the owner, which is the one thing replay does guarantee.
const arbMembers: fc.Arbitrary<TripMember[]> = fc
  .uniqueArray(fc.tuple(uuid, fc.constantFrom<TripRole>("owner", "editor", "viewer")), {
    minLength: 1,
    maxLength: 3,
    selector: ([userId]) => userId,
  })
  .map((rows) => rows.map(([userId, role], i) => ({ userId, role: i === 0 ? ("owner" as const) : role })));

// Structurally valid TripState: activity ids partitioned across days + backlog.
const arbTripState: fc.Arbitrary<TripState> = fc
  .record({
    tripId: uuid,
    name: fc.string({ minLength: 1, maxLength: 40 }),
    members: arbMembers,
    // Lineage is genesis-only and never replayed into by a command, so like a
    // non-owner member it has to be generated directly or the round-trip
    // property would pass while never seeing one (M11 link 5).
    forkedFrom: fc.option(
      fc.record({
        tripId: uuid,
        atSeq: fc.integer({ min: 1, max: 500 }),
        name: fc.string({ minLength: 1, maxLength: 40 }),
      }),
      { nil: null },
    ),
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
          members: s.members,
          forkedFrom: s.forkedFrom,
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

// Floors MEASURED, not guessed, per support/witness.ts: five runs observed
// kinds 204/213/180/224/229 and tags 173/205/167/209/202, so the floors sit
// near half of each observed minimum (180 and 167). Vacuity collapses these to
// ~0, so half is plenty of signal with room for fast-check's variance.
const FLOOR_KIND = 90;
const FLOOR_TAGS = 80;
// Roles measured the same way over five runs: 45/47/51/42/48, so half of the
// observed minimum (42) is the floor.
const FLOOR_ROLE = 20;

describe("hydrate", () => {
  it("is the inverse of tripDetailFromState (round-trip)", () => {
    // Witnesses on the fields whose generators could quietly stop varying:
    // the round-trip assertion alone would still pass if `activity` only ever
    // produced `planned`/`[]`, or if every member were an owner — the fields
    // would be carried, but never actually varied, and the property would say
    // nothing about them. See support/witness.ts.
    const kinds = witness("hydrate round-trip: non-planned kind");
    const tags = witness("hydrate round-trip: non-empty tags");
    const roles = witness("hydrate round-trip: a non-owner member");
    fc.assert(
      fc.property(arbTripState, (state) => {
        for (const a of Object.values(state.activities)) {
          if (a.kind !== "planned") kinds.tick();
          if (a.tags.length > 0) tags.tick();
        }
        if (state.members.some((m) => m.role !== "owner")) roles.tick();
        const roundTripped = hydrate(tripDetailFromState(state, "2027-01-01T00:00:00.000Z"));
        expect(tripStatesEqual(roundTripped, state)).toBe(true);
      }),
    );
    kinds.atLeast(FLOOR_KIND);
    tags.atLeast(FLOOR_TAGS);
    roles.atLeast(FLOOR_ROLE);
  });
});
