import { describe, expect, it } from "vitest";
import {
  ActivityView,
  CreateSavedDayInput,
  SavedDay,
  SavedDaySequence,
  SavedDayVisibility,
  SavedStop,
} from "../src";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const dayId = "11111111-1111-4111-8111-111111111111";

const stop = {
  title: "Fushimi Inari",
  timeWindow: { start: "09:00", end: "11:00" },
  location: { name: "Kyoto" },
  notes: null,
  anchors: [],
  kind: "planned",
  tags: [],
  cost: null,
  dayIndex: 0,
};

const savedDay = {
  savedDayId: "3c5e7f90-2222-4333-8444-555566667777",
  ownerId: "dev-alice",
  name: "A day in Nakameguro",
  stops: [stop],
  dayCount: 1,
  cities: ["Kyoto"],
  visibility: "private",
  authorKind: "human",
  adds: 0,
  sourceTripId: tripId,
  sourceTripName: "Kyoto",
  createdAt: "2026-08-01T00:00:00.000Z",
};

describe("SavedStop", () => {
  it("round-trips", () => {
    expect(SavedStop.parse(stop)).toEqual(stop);
  });

  // An id would tie the fragment to the activity it came from, so inserting
  // the same saved day into two trips would put one id in two streams — the
  // KI-1 hazard, and the same reason cloneTrip remaps ids.
  it("carries no activityId, and strips one that is supplied", () => {
    expect(Object.keys(SavedStop.shape)).not.toContain("activityId");
    const parsed = SavedStop.parse({ ...stop, activityId: dayId });
    expect(Object.keys(parsed)).not.toContain("activityId");
  });

  // Everything a stop needs to be a plan again, and nothing more — plus the one
  // field that is about the SEQUENCE rather than about the stop.
  //
  // **`dayIndex` is the deliberate exception, and it is the only one.** Before
  // M23 this asserted `SavedStop === ActivityView - activityId` exactly, and
  // that was the right assertion while a Playbook was one day: everything a
  // saved stop knew, an activity knew. A sequence needs each stop to say which
  // of its days it is on, and a trip activity has no equivalent — its day is
  // `day.activityIds`, a relationship the trip owns. Listing the exception by
  // name keeps the original property: a stop gains nothing else quietly.
  it("carries the same planning fields an ActivityView does, plus dayIndex", () => {
    const viewKeys = Object.keys(ActivityView.shape).filter((k) => k !== "activityId");
    expect(Object.keys(SavedStop.shape).sort()).toEqual([...viewKeys, "dayIndex"].sort());
  });

  // The whole additive property (ADR-048 decision 1, KI-20260905-l): a stop
  // stored before M23 parses, on day one, which is what it always meant.
  it("defaults dayIndex to 0, so a stop written before M23 reads as day one", () => {
    const { dayIndex: _omitted, ...beforeM23 } = stop;
    expect(SavedStop.parse(beforeM23).dayIndex).toBe(0);
  });

  it("refuses a dayIndex that is negative or fractional", () => {
    expect(SavedStop.safeParse({ ...stop, dayIndex: -1 }).success).toBe(false);
    expect(SavedStop.safeParse({ ...stop, dayIndex: 1.5 }).success).toBe(false);
  });
});

describe("SavedDaySequence", () => {
  // ADR-048 decision 3 — the WRITE path's invariant, and it lives on its own
  // schema precisely so the two read boundaries (which share
  // `SavedStop.array()`) do not inherit it and start dropping rows.
  it("accepts a non-decreasing dayIndex", () => {
    const ok = [stop, { ...stop, dayIndex: 0 }, { ...stop, dayIndex: 2 }];
    expect(SavedDaySequence.safeParse(ok).success).toBe(true);
  });

  it("refuses a dayIndex that goes backwards", () => {
    const bad = [{ ...stop, dayIndex: 1 }, { ...stop, dayIndex: 0 }];
    expect(SavedDaySequence.safeParse(bad).success).toBe(false);
  });

  // The seam that must not move. A refinement on the shared array would reach
  // `fromRow` and `toDiscoverDay` and empty a library over an ordering.
  it("leaves the plain SavedStop array tolerant, which is what the read sites use", () => {
    const bad = [{ ...stop, dayIndex: 1 }, { ...stop, dayIndex: 0 }];
    expect(SavedStop.array().safeParse(bad).success).toBe(true);
  });
});

describe("SavedDay", () => {
  it("round-trips", () => {
    expect(SavedDay.parse(savedDay)).toEqual(savedDay);
  });

  // The default is the guarantee, not a convention every writer has to
  // remember: every row that existed before this column did was written by a
  // person, and so is every row `POST /api/saved-days` writes now. Only the
  // content importer says otherwise, and it says so explicitly.
  it("defaults authorKind to human, and takes ai when a producer says so", () => {
    const { authorKind: _omitted, ...withoutAuthor } = savedDay;
    expect(SavedDay.parse(withoutAuthor).authorKind).toBe("human");
    expect(SavedDay.parse({ ...savedDay, authorKind: "ai" }).authorKind).toBe("ai");
    expect(SavedDay.safeParse({ ...savedDay, authorKind: "robot" }).success).toBe(false);
  });

  it("accepts a day with no stops in the DTO — the API is what refuses to create one", () => {
    expect(SavedDay.parse({ ...savedDay, stops: [] }).stops).toEqual([]);
  });

  it("requires a name", () => {
    expect(SavedDay.safeParse({ ...savedDay, name: "" }).success).toBe(false);
  });

  // A snapshot, on the same terms as a trip's lineage (ADR-028) — the credit
  // has to survive the source being renamed or deleted.
  it("requires the remembered source-trip name", () => {
    expect(SavedDay.safeParse({ ...savedDay, sourceTripName: "" }).success).toBe(false);
  });

  // M11b link 1. `[]` and not an omitted field: "how many cities does this day
  // touch" has to be a length on every day, including the ones that touch none.
  it("carries cities, and takes an empty list for a day that visits nowhere", () => {
    expect(SavedDay.parse({ ...savedDay, cities: [] }).cities).toEqual([]);
    expect(SavedDay.safeParse({ ...savedDay, cities: undefined }).success).toBe(false);
  });

  // The column is derived, so a blank city means the derivation leaked an
  // empty string rather than skipping the stop — a bad row, not a city.
  it("rejects a blank city", () => {
    expect(SavedDay.safeParse({ ...savedDay, cities: ["Kyoto", ""] }).success).toBe(false);
  });

  it("rejects cities that are not strings", () => {
    expect(SavedDay.safeParse({ ...savedDay, cities: "Kyoto" }).success).toBe(false);
    expect(SavedDay.safeParse({ ...savedDay, cities: [{ name: "Kyoto" }] }).success).toBe(false);
  });

  // M11b link 3. There is no third state and no absent state: a day is either
  // private or public, and the DEFAULT is decided by the column, not by an
  // omitted field the reader has to interpret.
  it("requires a visibility, and refuses anything outside the enum", () => {
    expect(SavedDay.parse(savedDay).visibility).toBe("private");
    expect(SavedDay.safeParse({ ...savedDay, visibility: undefined }).success).toBe(false);
    expect(SavedDay.safeParse({ ...savedDay, visibility: "unlisted" }).success).toBe(false);
    expect(SavedDay.safeParse({ ...savedDay, visibility: "Public" }).success).toBe(false);
    expect(SavedDay.safeParse({ ...savedDay, visibility: true }).success).toBe(false);
  });

  // M11b link 4. The counter is denormalised from the ledger, so the shapes
  // that cannot come from a `count(*)` are the ones worth refusing.
  it("takes a whole, non-negative adds count and nothing else", () => {
    expect(SavedDay.parse({ ...savedDay, adds: 12 }).adds).toBe(12);
    expect(SavedDay.safeParse({ ...savedDay, adds: -1 }).success).toBe(false);
    expect(SavedDay.safeParse({ ...savedDay, adds: 1.5 }).success).toBe(false);
    expect(SavedDay.safeParse({ ...savedDay, adds: undefined }).success).toBe(false);
  });
});

describe("SavedDayVisibility", () => {
  // Both members, in this order, spelled once. A build that reads a
  // visibility out of a row or a URL parses it against this rather than
  // comparing to a literal — the rule M11a set for `AdmissionRefusal`.
  it("is exactly private and public", () => {
    expect(SavedDayVisibility.options).toEqual(["private", "public"]);
  });

  it("refuses casing variants, whitespace and non-strings", () => {
    for (const bad of ["Private", "PUBLIC", "public ", " public", "", null, 1, ["public"]]) {
      expect(SavedDayVisibility.safeParse(bad).success, String(bad)).toBe(false);
    }
  });
});

describe("CreateSavedDayInput", () => {
  // The client names a day and points at it; the SERVER reads the stops.
  // Letting a client post plan content would make this an unvalidated write
  // path into a person's library.
  it("takes a name and pointers, never the stops", () => {
    expect(Object.keys(CreateSavedDayInput.shape).sort()).toEqual(["dayIds", "name", "tripId"]);
    const parsed = CreateSavedDayInput.parse({ name: "A day", tripId, dayIds: [dayId], stops: [stop] });
    expect(Object.keys(parsed)).not.toContain("stops");
  });

  // M23 link 2's constraint: one day stays the ordinary case, so the
  // single-day call must not get HARDER. A one-element array is not harder —
  // and there is deliberately no second shape (`dayId | dayIds`) for a caller
  // to branch on forever.
  it("takes a one-element list for the ordinary single-day keep", () => {
    expect(CreateSavedDayInput.parse({ name: "A day", tripId, dayIds: [dayId] }).dayIds).toEqual([dayId]);
  });

  it("rejects an empty selection, and one longer than a trip may be", () => {
    expect(CreateSavedDayInput.safeParse({ name: "A day", tripId, dayIds: [] }).success).toBe(false);
    const tooMany = Array.from({ length: 367 }, () => dayId);
    expect(CreateSavedDayInput.safeParse({ name: "A day", tripId, dayIds: tooMany }).success).toBe(false);
  });

  it("rejects a blank name", () => {
    expect(CreateSavedDayInput.safeParse({ name: "", tripId, dayIds: [dayId] }).success).toBe(false);
  });

  it("rejects ids that are not uuids", () => {
    expect(CreateSavedDayInput.safeParse({ name: "A day", tripId: "x", dayIds: [dayId] }).success).toBe(false);
    expect(CreateSavedDayInput.safeParse({ name: "A day", tripId, dayIds: ["x"] }).success).toBe(false);
  });
});
