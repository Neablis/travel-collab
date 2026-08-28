import { describe, expect, it } from "vitest";
import { diffTripStates, evolveTrip, tripStatesEqual, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";

const stateWith = (area: string | undefined): TripState => ({
  tripId: TRIP,
  name: "Japan",
  members: [{ userId: "u1", role: "owner" }],
  // Added when this landed on the M11 branch: link 5 (clone-with-lineage) put
  // `forkedFrom` on TripState, and this literal was written off a `main` that
  // predated it. The merge is what caught it — a good demonstration of the
  // hand-enumeration trap firing in the other direction.
  forkedFrom: null,
  startDate: null,
  days: [{ dayId: DAY, activityIds: [A1] }],
  backlog: [],
  activities: {
    [A1]: {
      title: "Dinner at Gonpachi",
      timeWindow: null,
      // Same name/lat/lng/city in both states — `area` is the ONLY difference,
      // so nothing but an area-aware comparison can tell them apart.
      location: {
        name: "Gonpachi Nishiazabu, Nishi-Azabu, Tokyo, Japan",
        city: "Tokyo",
        lat: 35.6564,
        lng: 139.7238,
        ...(area === undefined ? {} : { area }),
      },
      notes: null,
      anchors: [],
      kind: "planned" as const,
      tags: [],
      cost: null,
    },
  },
  dismissedConflictIds: [],
  currency: "USD",
  budget: null,
  status: "active" as const,
});

// equality.ts compares Location field by field, so a contract field it forgets
// is a field diff() treats as unchanged — an edit that revert/undo silently
// keeps at its old value, with no failure anywhere to say so. That is the
// hand-enumeration trap KI-35's contract change had to walk past.
describe("KI-35 — `area` is part of activity equality", () => {
  it("two states differing only by location.area are not equal", () => {
    expect(tripStatesEqual(stateWith("Nishi-Azabu"), stateWith("Ebisu"))).toBe(false);
    expect(tripStatesEqual(stateWith(undefined), stateWith("Nishi-Azabu"))).toBe(false);
    expect(tripStatesEqual(stateWith("Nishi-Azabu"), stateWith("Nishi-Azabu"))).toBe(true);
  });

  it("diff emits an update for an area-only change, and replaying it lands on the target", () => {
    const current = stateWith("Nishi-Azabu");
    const target = stateWith("Ebisu");
    const events = diffTripStates(current, target);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe("ActivityUpdated");
    if (events[0]!.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(events[0]!.payload.location?.area).toBe("Ebisu");

    // The half this test's own name promised and did not do (CodeRabbit, #72).
    // Event SHAPE is not replay behaviour: a payload can carry the right area
    // and still not land, if evolve drops or mis-merges the field. Replaying
    // is what closes the loop diff() opens, and it is also the only assertion
    // here that is independent of `tripStatesEqual` — a deepEqual, not the
    // predicate under test judging itself.
    const replayed = events.reduce<TripState | null>((st, e) => evolveTrip(st, e), current);
    expect(replayed).toEqual(target);
    expect(replayed?.activities[A1]?.location?.area).toBe("Ebisu");
  });

  it("clearing an area is a change too", () => {
    const events = diffTripStates(stateWith("Nishi-Azabu"), stateWith(undefined));
    expect(events.map((e) => e.type)).toEqual(["ActivityUpdated"]);
  });
});

// KI-54 (CodeRabbit on #72): `area` was added to the comparison above, and the
// same audit found `city` and `countryCode` had never been in it — so an edit
// touching only one of those was invisible to diff(), and revert/undo kept the
// old value with nothing anywhere reporting a failure. Not hypothetical: the
// `accept-language=en` geocoding change re-renders a Japanese location's `city`
// and nothing else.
//
// One test PER FIELD rather than one covering both. A single combined case
// would pass with only one of the two comparisons present, which is the very
// shape of bug this describes.
describe("KI-54 — every persisted Location field is part of equality", () => {
  const withLocation = (patch: Record<string, unknown>): TripState => {
    const base = stateWith("Nishi-Azabu");
    const activity = base.activities[A1]!;
    return {
      ...base,
      activities: {
        [A1]: { ...activity, location: { ...activity.location!, ...patch } },
      },
    };
  };

  it("a city-only change is not equal, and diffs", () => {
    const current = withLocation({ city: "Tokyo" });
    const target = withLocation({ city: "Kyoto" });
    expect(tripStatesEqual(current, target)).toBe(false);
    expect(diffTripStates(current, target).map((e) => e.type)).toEqual(["ActivityUpdated"]);
  });

  it("a countryCode-only change is not equal, and diffs", () => {
    const current = withLocation({ countryCode: "JP" });
    const target = withLocation({ countryCode: "FR" });
    expect(tripStatesEqual(current, target)).toBe(false);
    expect(diffTripStates(current, target).map((e) => e.type)).toEqual(["ActivityUpdated"]);
  });

  it("replaying a city-only diff lands on the target", () => {
    const current = withLocation({ city: "Tokyo" });
    const target = withLocation({ city: "Kyoto" });
    const replayed = diffTripStates(current, target).reduce<TripState | null>(
      (st, e) => evolveTrip(st, e),
      current,
    );
    expect(replayed).toEqual(target);
  });
});
