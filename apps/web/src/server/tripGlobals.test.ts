import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { buildTripGlobals } from "./tripGlobals";

// A trip whose middle day travels: it ends in a second city, so it appears in
// two cities' `dayIndexes`. That is the case every count below is shaped by,
// and the one a naive implementation gets wrong.
function travelTrip(): TripDetail {
  const base = tripDetailFixture();
  const stop = (id: string, city: string, start: string, extra: Record<string, unknown> = {}) => ({
    activityId: id, tripId: base.tripId, title: `Stop ${id}`, dayId: "", position: 0,
    timeWindow: { start, end: start }, location: { city }, notes: null, anchors: [],
    kind: "planned", tags: [], cost: null, ...extra,
  });
  return {
    ...base,
    days: [
      { dayId: "d0", activityIds: ["a1", "a2"], date: "2026-08-01", costSubtotal: 0 },
      { dayId: "d1", activityIds: ["a3", "a4"], date: "2026-08-02", costSubtotal: 0 },
    ],
    activities: {
      a1: stop("a1", "Tokyo", "09:00"),
      a2: stop("a2", "Tokyo", "12:00", { tags: ["meal"], kind: "booked" }),
      // The travel day: starts in Tokyo, ends in Kyoto.
      a3: stop("a3", "Tokyo", "09:00"),
      a4: stop("a4", "Kyoto", "18:00", { tags: ["meal", "lodging"] }),
    } as unknown as TripDetail["activities"],
  };
}

describe("buildTripGlobals", () => {
  it("gives each day its cities in arrival order, from the shared rule", () => {
    const g = buildTripGlobals(travelTrip());
    expect(g.days.map((d) => d.cities)).toEqual([["Tokyo"], ["Tokyo", "Kyoto"]]);
    expect(g.days.map((d) => d.index)).toEqual([0, 1]);
  });

  it("lists a travel day under both of its cities", () => {
    const g = buildTripGlobals(travelTrip());
    expect(g.cities.find((c) => c.name === "Tokyo")?.dayIndexes).toEqual([0, 1]);
    expect(g.cities.find((c) => c.name === "Kyoto")?.dayIndexes).toEqual([1]);
  });

  it("counts a stop against its OWN city, never against every city its day touches", () => {
    // The rule this pins, and the reason it is not "sum the day's stops into
    // each of the day's cities": day 1 touches two cities and has two stops,
    // one in each. Counting per day would give Tokyo 4 and Kyoto 2 — six stop
    // sightings for four stops.
    const g = buildTripGlobals(travelTrip());
    expect(g.cities.find((c) => c.name === "Tokyo")?.activityCount).toBe(3);
    expect(g.cities.find((c) => c.name === "Kyoto")?.activityCount).toBe(1);
    const counted = g.cities.reduce((n, c) => n + c.activityCount, 0);
    expect(counted).toBe(4);
  });

  it("counts tags across the trip, and a stop with two tags counts for both", () => {
    const g = buildTripGlobals(travelTrip());
    expect(g.tags.find((t) => t.tag === "meal")?.activityCount).toBe(2);
    expect(g.tags.find((t) => t.tag === "lodging")?.activityCount).toBe(1);
    // A tag nobody used is absent rather than present with zero — the
    // collection describes the trip, not the enum.
    expect(g.tags.find((t) => t.tag === "outdoors")).toBeUndefined();
  });

  it("counts booked stops", () => {
    expect(buildTripGlobals(travelTrip()).bookedCount).toBe(1);
  });

  it("reports empty collections for a trip with nothing in it, rather than failing", () => {
    const bare = { ...tripDetailFixture(), days: [], activities: {} } as TripDetail;
    const g = buildTripGlobals(bare);
    expect(g).toEqual({ days: [], cities: [], tags: [], bookedCount: 0 });
  });
});

// Found by CodeRabbit on PR 134. A backlog stop is an activity with no day, and
// its city was being dropped — but only sometimes, which is what made it a bug
// rather than a gap: the count loop incremented an EXISTING entry for any
// activity, so a backlog stop in Osaka counted when some unrelated day visited
// Osaka and vanished when none did.
describe("buildTripGlobals and the backlog", () => {
  function withBacklogStop(): TripDetail {
    const base = tripDetailFixture();
    const stop = (id: string, city: string) => ({
      activityId: id, tripId: base.tripId, title: `Stop ${id}`, dayId: null, position: 0,
      timeWindow: null, location: { city }, notes: null, anchors: [],
      kind: "planned", tags: [], cost: null,
    });
    return {
      ...base,
      days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 0 }],
      backlog: ["a2"],
      activities: {
        a1: { ...stop("a1", "Tokyo"), dayId: "d0", timeWindow: { start: "09:00", end: "10:00" } },
        a2: stop("a2", "Osaka"),
      } as unknown as TripDetail["activities"],
    };
  }

  it("lists a city that only an unscheduled stop is in, with no days behind it", () => {
    const g = buildTripGlobals(withBacklogStop());
    const osaka = g.cities.find((c) => c.name === "Osaka");
    expect(osaka).toBeDefined();
    expect(osaka!.dayIndexes).toEqual([]);
    expect(osaka!.activityCount).toBe(1);
  });

  it("counts every stop exactly once, scheduled or not", () => {
    const g = buildTripGlobals(withBacklogStop());
    expect(g.cities.reduce((n, c) => n + c.activityCount, 0)).toBe(2);
  });
});

// Found by Copilot on PR 134. `ActivityTag[]` carries no uniqueness refinement,
// so a stop tagged ["meal", "meal"] is valid stored data — and `activityCount`
// promises "how many stops carry this tag", not how many tag entries exist.
describe("buildTripGlobals and duplicate tags", () => {
  it("counts a stop once per tag however many times the stop repeats it", () => {
    const base = tripDetailFixture();
    const detail = {
      ...base,
      days: [{ dayId: "d0", activityIds: ["a1"], date: "2026-08-01", costSubtotal: 0 }],
      activities: {
        a1: {
          activityId: "a1", tripId: base.tripId, title: "Lunch twice over", dayId: "d0",
          position: 0, timeWindow: { start: "12:00", end: "13:00" }, location: { city: "Tokyo" },
          notes: null, anchors: [], kind: "planned", tags: ["meal", "meal"], cost: null,
        },
      } as unknown as TripDetail["activities"],
    } as TripDetail;
    expect(buildTripGlobals(detail).tags.find((t) => t.tag === "meal")?.activityCount).toBe(1);
  });
});
