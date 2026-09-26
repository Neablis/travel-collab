import { describe, expect, it } from "vitest";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { tripDetailFixture } from "@tc/factories";
import { placeCommands, resolveDrop } from "./resolveDrop";

const A1 = "a1";
const A2 = "a2";
const A3 = "a3";
const DAY_1 = "day-1";
const DAY_2 = "day-2";

// Same fixture style as board.test.tsx: tripDetailFixture with the days and
// activities this file's assertions need. Day 1 holds a1, a2; day 2 holds a3.
function fixture() {
  const activity = (activityId: string, title: string) => ({
    activityId,
    title,
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned" as const,
    tags: [],
    cost: null,
    bookedBy: null,
    participants: [],
    mode: null,
    endLocation: null,
    pendingReason: null,
  });
  return tripDetailFixture({
    days: [
      { dayId: DAY_1, activityIds: [A1, A2], date: null, costSubtotal: 0 },
      { dayId: DAY_2, activityIds: [A3], date: null, costSubtotal: 0 },
    ],
    activities: {
      [A1]: activity(A1, "Colosseum"),
      [A2]: activity(A2, "Vatican Museums"),
      [A3]: activity(A3, "Trastevere walk"),
    },
  });
}

const trip = fixture();

// attachClosestEdge stores the edge under a private `Symbol` key. Hand-writing
// that key would encode a library internal that is free to change, so these
// fixtures call the real attacher against a stubbed 100x100 rect and let it
// pick the edge from where the pointer sits.
function edgeData(edge: "top" | "bottom"): Record<string | symbol, unknown> {
  const element = document.createElement("div");
  element.getBoundingClientRect = () => ({
    top: 0,
    bottom: 100,
    left: 0,
    right: 100,
    width: 100,
    height: 100,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  const input = {
    altKey: false,
    button: 0,
    buttons: 1,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    clientX: 50,
    clientY: edge === "top" ? 5 : 95,
    pageX: 50,
    pageY: edge === "top" ? 5 : 95,
  };
  return attachClosestEdge({}, { element, input, allowedEdges: ["top", "bottom"] });
}

const topEdge = () => edgeData("top");
const bottomEdge = () => edgeData("bottom");

describe("resolveDrop", () => {
  it("routes a drop on the rack to unschedule", () => {
    expect(resolveDrop(trip, { activityId: A1 }, { rack: true })).toEqual({
      kind: "unschedule",
      activityId: A1,
    });
  });

  it("appends when dropped on a day column", () => {
    expect(resolveDrop(trip, { activityId: A3 }, { dayId: DAY_1 })).toEqual({
      kind: "move",
      activityId: A3,
      toDayId: DAY_1,
      position: 2,
    });
  });

  // Mitchell, PR #55: "Select a activity that isnt first or last / Drag around
  // but dont let go / Move back to the ghost location for the original drop
  // location and try to drop into original location. Expected: Stay at current
  // location, dont move. Reality: Moves to end of day."
  //
  // The mechanism: ActivityCard's `canDrop` rejects its own source, so a card
  // is not a drop target for itself. Releasing over a stop's own position
  // therefore finds no card and lands on the column — which used to append.
  it("is a no-op when a stop is dropped on the column of the day it is already on", () => {
    expect(resolveDrop(trip, { activityId: A1 }, { dayId: DAY_1 })).toBeNull();
    expect(resolveDrop(trip, { activityId: A2 }, { dayId: DAY_1 })).toBeNull();
  });

  it("still appends a stop arriving on a column from another day", () => {
    // The behaviour above must not cost the cross-day drop, which is the only
    // reason the column branch exists.
    expect(resolveDrop(trip, { activityId: A3 }, { dayId: DAY_1 })).toEqual({
      kind: "move",
      activityId: A3,
      toDayId: DAY_1,
      position: 2,
    });
  });

  it("still appends a stop arriving on a column from the rack", () => {
    const parked = tripDetailFixture({
      days: [{ dayId: DAY_1, activityIds: [A1], date: null, costSubtotal: 0 }],
      backlog: [A2],
      activities: trip.activities,
    });
    expect(resolveDrop(parked, { activityId: A2 }, { dayId: DAY_1 })).toEqual({
      kind: "move",
      activityId: A2,
      toDayId: DAY_1,
      position: 1,
    });
  });

  it("keeps 'send it to the end' working, via the last card's bottom edge", () => {
    // The deliberate gesture the no-op above must not have eaten: dropping
    // below the last card resolves through the CARD branch, not the column.
    const target = { cardActivityId: A2, dayId: DAY_1, ...bottomEdge() };
    expect(resolveDrop(trip, { activityId: A1 }, target)).toEqual({
      kind: "move",
      activityId: A1,
      toDayId: DAY_1,
      position: 1,
    });
  });

  it("inserts before a card when the closest edge is the top", () => {
    const target = { cardActivityId: A2, dayId: DAY_1, ...topEdge() };
    expect(resolveDrop(trip, { activityId: A3 }, target)).toMatchObject({ position: 1 });
  });

  it("corrects the index when moving down within the same list", () => {
    // a1 (index 0) dropped below a2 (index 1): naive insert is 2, but removing
    // a1 first shifts everything left, so the correct position is 1.
    const target = { cardActivityId: A2, dayId: DAY_1, ...bottomEdge() };
    expect(resolveDrop(trip, { activityId: A1 }, target)).toMatchObject({ position: 1 });
  });

  it("does not correct the index when moving between lists", () => {
    const target = { cardActivityId: A2, dayId: DAY_1, ...bottomEdge() };
    expect(resolveDrop(trip, { activityId: A3 }, target)).toMatchObject({ position: 2 });
  });

  it("is a no-op without an activity id or without a target", () => {
    expect(resolveDrop(trip, {}, { rack: true })).toBeNull();
    expect(resolveDrop(trip, { activityId: A1 }, undefined)).toBeNull();
  });

  it("prefers the rack over a day id on the same target", () => {
    // Guards the branch order: the rack check must come first, so a rack
    // target that also carries a stale dayId still unschedules.
    expect(resolveDrop(trip, { activityId: A1 }, { rack: true, dayId: DAY_1 })).toMatchObject({
      kind: "unschedule",
    });
  });
});

// M29 part 3: a drop on a day's river carries the window the outline showed
// (DayRiver's drop target computes it from the pointer, riverGestures.ts).
describe("resolveDrop on a river", () => {
  const timed = (start: string, end: string) => ({ timeWindow: { start, end } });
  // Day 1: a1 09:00–10:00, a2 14:00–15:00. Day 2: a3 11:00–12:30.
  const river = tripDetailFixture({
    ...trip,
    activities: {
      [A1]: { ...trip.activities[A1]!, ...timed("09:00", "10:00") },
      [A2]: { ...trip.activities[A2]!, ...timed("14:00", "15:00") },
      [A3]: { ...trip.activities[A3]!, ...timed("11:00", "12:30") },
    },
  });
  const at = (start: string, end: string) => ({ dayId: DAY_1, riverWindow: { start, end } });

  it("moves a stop from another day and re-times it, placed among the day's stops by the clock", () => {
    expect(resolveDrop(river, { activityId: A3 }, at("12:00", "13:30"))).toEqual({
      kind: "place",
      activityId: A3,
      toDayId: DAY_1,
      position: 1,
      timeWindow: { start: "12:00", end: "13:30" },
    });
  });

  it("only re-times a stop dropped on its own day", () => {
    expect(resolveDrop(river, { activityId: A1 }, at("16:00", "17:00"))).toEqual({
      kind: "place",
      activityId: A1,
      toDayId: DAY_1,
      position: null,
      timeWindow: { start: "16:00", end: "17:00" },
    });
  });

  it("is a no-op dropped back where it already is", () => {
    expect(resolveDrop(river, { activityId: A1 }, at("09:00", "10:00"))).toBeNull();
  });

  it("carries a move to another day and a time out as one batch, the move first", () => {
    const outcome = resolveDrop(river, { activityId: A3 }, at("12:00", "13:30"));
    expect(outcome?.kind === "place" && placeCommands("t", outcome)).toEqual([
      { type: "MoveActivity", tripId: "t", activityId: A3, toDayId: DAY_1, position: 1 },
      { type: "UpdateActivity", tripId: "t", activityId: A3, timeWindow: { start: "12:00", end: "13:30" } },
    ]);
  });

  it("carries a new time on the same day out as the time alone", () => {
    const outcome = resolveDrop(river, { activityId: A1 }, at("16:00", "17:00"));
    expect(outcome?.kind === "place" && placeCommands("t", outcome)).toEqual([
      { type: "UpdateActivity", tripId: "t", activityId: A1, timeWindow: { start: "16:00", end: "17:00" } },
    ]);
  });

  it("leaves a stop from the rack to the rack's own rule", () => {
    const parked = tripDetailFixture({ ...river, days: [{ dayId: DAY_1, activityIds: [A1], date: null, costSubtotal: 0 }], backlog: [A2] });
    expect(resolveDrop(parked, { activityId: A2 }, at("16:00", "17:00"))).toEqual({
      kind: "move",
      activityId: A2,
      toDayId: DAY_1,
      position: 1,
    });
  });
});
