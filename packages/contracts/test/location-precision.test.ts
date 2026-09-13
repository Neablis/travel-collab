import { describe, expect, it } from "vitest";
import { Location, TripCommand, TripDetail, TripEvent } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000b";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000b1";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000e";

// A `trip_details.doc` exactly as the projection wrote it BEFORE Location grew
// `precision`. `getTripDetail` returns this column as raw jsonb with no parse
// of its own and the read route runs `TripDetail.parse` on it, so this is what
// every trip nobody has touched since the change still has to survive. The
// same tripwire `area` has (ki35-location-area.test.ts), for the same reason:
// M18 shipped a required field into this shape and 500'd every pre-M18 board.
const PRE_PRECISION_DOC = {
  tripId: TRIP,
  name: "Korea",
  status: "active",
  startDate: "2026-10-01",
  currency: "USD",
  budget: null,
  members: [{ userId: "u1", role: "owner" }],
  days: [{ dayId: DAY, activityIds: [A1], date: "2026-10-01", costSubtotal: 0 }],
  backlog: [],
  activities: {
    [A1]: {
      activityId: A1,
      title: "Makgeolli alley evening",
      timeWindow: null,
      location: { name: "Makgeolli alley", city: "Jeonju-si", countryCode: "KR" },
      notes: null,
      anchors: [],
      kind: "planned",
      tags: [],
      cost: null,
    },
  },
  conflicts: [],
  dismissedConflictIds: [],
  createdAt: "2026-09-01T00:00:00.000Z",
  unscheduledCostSubtotal: 0,
  tripCostTotal: 0,
  budgetRemaining: null,
};

describe("Location.precision", () => {
  const AT = { lat: 35.8242, lng: 127.148 };

  it("accepts the three tiers the content pipeline already uses, and nothing else", () => {
    for (const precision of ["venue", "area", "city"] as const) {
      expect(Location.parse({ name: "x", ...AT, precision }).precision).toBe(precision);
    }
    expect(() => Location.parse({ name: "x", ...AT, precision: "approximate" })).toThrow();
    expect(() => Location.parse({ name: "x", ...AT, precision: "exact" })).toThrow();
  });

  // `precision` describes the coordinates, so it cannot outlive them.
  // `sanitizeCoords` already drops it alongside a null-island pair; this makes
  // the rule structural rather than one writer's discipline (CodeRabbit, PR 169).
  it("refuses a precision that describes coordinates which are not there", () => {
    expect(() => Location.parse({ name: "x", precision: "city" })).toThrow(/precision requires coordinates/);
    // The pre-existing pairing rule is untouched, and a bare location with no
    // precision at all still parses — that is every location already stored.
    expect(Location.parse({ name: "x" }).precision).toBeUndefined();
    expect(() => Location.parse({ name: "x", lat: 35.8 })).toThrow();
  });

  // Absence is UNKNOWN, not `venue` — there is no `.default()` here on purpose.
  // A default would retroactively claim venue precision for every coordinate
  // already in the database, including hand-authored fixtures and every guess
  // the assistant has written.
  it("is absent rather than defaulted when nothing said what the coordinates describe", () => {
    expect(Location.parse({ name: "x", lat: 1, lng: 2 }).precision).toBeUndefined();
  });

  it("survives the command and event shapes it has to round-trip through", () => {
    const update = TripCommand.parse({
      type: "UpdateActivity",
      tripId: TRIP,
      activityId: A1,
      location: { name: "Makgeolli alley", city: "Jeonju-si", countryCode: "KR", lat: 35.8242, lng: 127.148, precision: "city" },
    });
    if (update.type !== "UpdateActivity") throw new Error("wrong type");
    expect(update.location?.precision).toBe("city");

    const updated = TripEvent.parse({
      type: "ActivityUpdated",
      version: 1,
      payload: {
        tripId: TRIP,
        activityId: A1,
        title: "Makgeolli alley evening",
        timeWindow: null,
        notes: null,
        anchors: [],
        kind: "planned",
        tags: [],
        cost: null,
        location: { name: "Makgeolli alley", city: "Jeonju-si", countryCode: "KR", lat: 35.8242, lng: 127.148, precision: "city" },
      },
    });
    if (updated.type !== "ActivityUpdated") throw new Error("wrong type");
    expect(updated.payload.location?.precision).toBe("city");
  });

  it("a projection document written before `precision` existed still parses", () => {
    const parsed = TripDetail.parse(PRE_PRECISION_DOC);
    expect(parsed.activities[A1]!.location?.precision).toBeUndefined();
    expect(parsed.activities[A1]!.location?.city).toBe("Jeonju-si");
  });
});
