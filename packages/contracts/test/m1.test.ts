import { describe, expect, it } from "vitest";
import {
  AddActivity,
  Location,
  MoveActivity,
  SetTripStartDate,
  TimeWindow,
  TripCommand,
  TripDetail,
  TripEvent,
  UpdateActivity,
} from "../src";

const TRIP = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const DAY = "7f8b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";
const ACT = "9a0c4e1f-5b9c-4d8f-9f5b-4d3c7e0f9a81";

describe("M1 contracts", () => {
  it("TimeWindow requires HH:mm and end after start", () => {
    expect(TimeWindow.safeParse({ start: "09:00", end: "11:00" }).success).toBe(true);
    expect(TimeWindow.safeParse({ start: "11:00", end: "09:00" }).success).toBe(false);
    expect(TimeWindow.safeParse({ start: "9:00", end: "11:00" }).success).toBe(false);
  });

  it("Location requires lat and lng together", () => {
    expect(Location.safeParse({ name: "Rome" }).success).toBe(true);
    expect(Location.safeParse({ name: "Rome", lat: 41.9, lng: 12.5 }).success).toBe(true);
    expect(Location.safeParse({ name: "Rome", lat: 41.9 }).success).toBe(false);
  });

  it("SetTripStartDate takes YYYY-MM-DD or null to clear", () => {
    expect(SetTripStartDate.safeParse({ type: "SetTripStartDate", tripId: TRIP, startDate: "2027-05-01" }).success).toBe(true);
    expect(SetTripStartDate.safeParse({ type: "SetTripStartDate", tripId: TRIP, startDate: null }).success).toBe(true);
    expect(SetTripStartDate.safeParse({ type: "SetTripStartDate", tripId: TRIP, startDate: "May 1" }).success).toBe(false);
  });

  it("parses AddActivity into the backlog (no dayId)", () => {
    const cmd = AddActivity.parse({ type: "AddActivity", tripId: TRIP, activityId: ACT, title: "Colosseum" });
    expect(cmd.dayId).toBeUndefined();
  });

  it("MoveActivity uses null for the backlog", () => {
    const cmd = MoveActivity.parse({ type: "MoveActivity", tripId: TRIP, activityId: ACT, toDayId: null, position: 0 });
    expect(cmd.toDayId).toBeNull();
  });

  it("UpdateActivity distinguishes omitted (unchanged) from null (cleared)", () => {
    const cmd = UpdateActivity.parse({ type: "UpdateActivity", tripId: TRIP, activityId: ACT, timeWindow: null });
    expect(cmd.timeWindow).toBeNull();
    expect(cmd.title).toBeUndefined();
  });

  it("TripCommand and TripEvent discriminate on type", () => {
    const cmd = TripCommand.parse({ type: "AddDay", tripId: TRIP, dayId: DAY });
    expect(cmd.type).toBe("AddDay");
    const event = TripEvent.parse({ type: "DayAdded", version: 1, payload: { tripId: TRIP, dayId: DAY } });
    expect(event.type).toBe("DayAdded");
  });

  it("event payloads use explicit nulls, not missing keys", () => {
    expect(
      TripEvent.safeParse({
        type: "ActivityAdded",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, dayId: null, title: "Colosseum", timeWindow: null, location: null, notes: null },
      }).success,
    ).toBe(true);
    expect(
      TripEvent.safeParse({
        type: "ActivityAdded",
        version: 1,
        payload: { tripId: TRIP, activityId: ACT, title: "Colosseum" },
      }).success,
    ).toBe(false);
  });

  it("TripDetail parses a full board document", () => {
    const detail = TripDetail.parse({
      tripId: TRIP,
      name: "Rome 2027",
      startDate: "2027-05-01",
      currency: "USD",
      budget: null,
      status: "active",
      members: [{ userId: "dev-alice", role: "owner" }],
      days: [{ dayId: DAY, activityIds: [ACT], date: "2027-05-01", costSubtotal: 0 }],
      backlog: [],
      activities: {
        [ACT]: {
          activityId: ACT,
          title: "Colosseum",
          timeWindow: { start: "09:00", end: "11:00" },
          location: { name: "Rome", lat: 41.9, lng: 12.5 },
          notes: null,
          anchors: [],
          kind: "planned",
          tags: [],
          cost: null,
        },
      },
      conflicts: [],
      dismissedConflictIds: [],
      createdAt: "2026-07-08T12:00:00.000Z",
      unscheduledCostSubtotal: 0,
      tripCostTotal: 0,
      budgetRemaining: null,
    });
    expect(detail.days[0]!.activityIds).toEqual([ACT]);
  });
});
