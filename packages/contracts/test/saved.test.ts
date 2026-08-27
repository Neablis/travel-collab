import { describe, expect, it } from "vitest";
import { ActivityView, CreateSavedDayInput, SavedDay, SavedStop } from "../src";

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
};

const savedDay = {
  savedDayId: "3c5e7f90-2222-4333-8444-555566667777",
  ownerId: "dev-alice",
  name: "A day in Nakameguro",
  stops: [stop],
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

  // Everything a stop needs to be a plan again, and nothing more.
  it("carries the same planning fields an ActivityView does", () => {
    const viewKeys = Object.keys(ActivityView.shape).filter((k) => k !== "activityId").sort();
    expect(Object.keys(SavedStop.shape).sort()).toEqual(viewKeys);
  });
});

describe("SavedDay", () => {
  it("round-trips", () => {
    expect(SavedDay.parse(savedDay)).toEqual(savedDay);
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
});

describe("CreateSavedDayInput", () => {
  // The client names a day and points at it; the SERVER reads the stops.
  // Letting a client post plan content would make this an unvalidated write
  // path into a person's library.
  it("takes a name and a pointer, never the stops", () => {
    expect(Object.keys(CreateSavedDayInput.shape).sort()).toEqual(["dayId", "name", "tripId"]);
    const parsed = CreateSavedDayInput.parse({ name: "A day", tripId, dayId, stops: [stop] });
    expect(Object.keys(parsed)).not.toContain("stops");
  });

  it("rejects a blank name", () => {
    expect(CreateSavedDayInput.safeParse({ name: "", tripId, dayId }).success).toBe(false);
  });

  it("rejects ids that are not uuids", () => {
    expect(CreateSavedDayInput.safeParse({ name: "A day", tripId: "x", dayId }).success).toBe(false);
  });
});
