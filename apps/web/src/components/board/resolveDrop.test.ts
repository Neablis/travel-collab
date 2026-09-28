import { describe, expect, it } from "vitest";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { tripDetailFixture } from "@tc/factories";
import { anyTimeCommands, placeCommands, resolveDrop } from "./resolveDrop";

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

// The same trip with a1 given a time. The rack unschedules a stop that is on
// the schedule — a timed one; an untimed one on a day is already drawn in the
// rack (PR #269), and its own describe below covers it.
const timedA1 = tripDetailFixture({
  ...trip,
  activities: { ...trip.activities, [A1]: { ...trip.activities[A1]!, timeWindow: { start: "09:00", end: "10:00" } } },
});

describe("resolveDrop", () => {
  it("routes a drop on the rack to unschedule", () => {
    expect(resolveDrop(timedA1, { activityId: A1 }, { rack: true })).toEqual({
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
    expect(resolveDrop(timedA1, { activityId: A1 }, { rack: true, dayId: DAY_1 })).toMatchObject({
      kind: "unschedule",
    });
  });
});

// PR #269: a day's untimed stops are drawn in the Unscheduled rack under their
// day, and a day column's "any time" chip is a drop target meaning "this day,
// no time" — the gesture the old "Any time" shelf's column drop was.
describe("resolveDrop and a day's untimed stops", () => {
  const chip = (dayId: string) => ({ dayId, anyTime: true });

  it("takes a timed stop's time away when it is dropped on its own day's chip, and moves nothing", () => {
    expect(resolveDrop(timedA1, { activityId: A1 }, chip(DAY_1))).toEqual({
      kind: "anyTime",
      activityId: A1,
      toDayId: DAY_1,
      position: null,
      clearTime: true,
    });
  });

  it("moves a timed stop to the end of another day and takes its time away, as one batch", () => {
    const outcome = resolveDrop(timedA1, { activityId: A1 }, chip(DAY_2));
    expect(outcome).toEqual({ kind: "anyTime", activityId: A1, toDayId: DAY_2, position: 1, clearTime: true });
    expect(outcome?.kind === "anyTime" && anyTimeCommands("t", outcome)).toEqual([
      { type: "MoveActivity", tripId: "t", activityId: A1, toDayId: DAY_2, position: 1 },
      { type: "UpdateActivity", tripId: "t", activityId: A1, timeWindow: null },
    ]);
  });

  it("only moves an untimed stop dropped on another day's chip — it has no time to clear", () => {
    const outcome = resolveDrop(trip, { activityId: A1 }, chip(DAY_2));
    expect(outcome).toEqual({ kind: "anyTime", activityId: A1, toDayId: DAY_2, position: 1, clearTime: false });
    expect(outcome?.kind === "anyTime" && anyTimeCommands("t", outcome)).toEqual([
      { type: "MoveActivity", tripId: "t", activityId: A1, toDayId: DAY_2, position: 1 },
    ]);
  });

  it("gives a parked stop a day and no time", () => {
    const parked = tripDetailFixture({ ...timedA1, days: [{ dayId: DAY_1, activityIds: [A2], date: null, costSubtotal: 0 }], backlog: [A1] });
    expect(resolveDrop(parked, { activityId: A1 }, chip(DAY_1))).toEqual({
      kind: "anyTime",
      activityId: A1,
      toDayId: DAY_1,
      position: 1,
      clearTime: true,
    });
  });

  it("is a no-op for an untimed stop dropped on its own day's chip", () => {
    expect(resolveDrop(trip, { activityId: A1 }, chip(DAY_1))).toBeNull();
  });

  // The rack is the only place such a stop can be picked up from, so a drag
  // that ends on the rack is a card put back where it was. Unscheduling it
  // would strip its day and jump it to the front of the drawer (Mitchell's
  // "put it back and it moves" report on PR #55, in a new place).
  it("is a no-op for an untimed stop on a day dropped back on the rack", () => {
    expect(resolveDrop(trip, { activityId: A1 }, { rack: true })).toBeNull();
  });

  // Mitchell, PR #269 (decision 3C): the rack's "No day" section is where a
  // drop is aimed at "no day at all", so there it does take the stop off its
  // day — the one way left to turn "any time on Day 3" into "no day".
  it("takes an untimed stop off its day when dropped on the rack's No day section", () => {
    expect(resolveDrop(trip, { activityId: A1 }, { rack: true, noDay: true })).toEqual({
      kind: "unschedule",
      activityId: A1,
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

  it("only re-times a stop dropped on its own day when it keeps its place among the day's stops", () => {
    expect(resolveDrop(river, { activityId: A1 }, at("11:00", "12:00"))).toEqual({
      kind: "place",
      activityId: A1,
      toDayId: DAY_1,
      position: null,
      timeWindow: { start: "11:00", end: "12:00" },
    });
  });

  it("moves a stop re-timed past a later stop on its own day past it in the list too", () => {
    // a1 09:00 to 16:00 goes after a2 (14:00): the phone's card list reads the
    // day's list, and it should read the day in clock order.
    expect(resolveDrop(river, { activityId: A1 }, at("16:00", "17:00"))).toEqual({
      kind: "place",
      activityId: A1,
      toDayId: DAY_1,
      position: 1,
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

  it("carries a new time on the same day out as the time alone when the order holds", () => {
    const outcome = resolveDrop(river, { activityId: A1 }, at("11:00", "12:00"));
    expect(outcome?.kind === "place" && placeCommands("t", outcome)).toEqual([
      { type: "UpdateActivity", tripId: "t", activityId: A1, timeWindow: { start: "11:00", end: "12:00" } },
    ]);
  });

  // Mitchell, 2026-09-26: "When dragging and dropping from anywhere, it should
  // have same functionality". A stop off the rack is placed like any other —
  // it used to be left to the rack's fitted time (`rackDropWindow`).
  describe("a stop off the Unscheduled rack", () => {
    // Day 1 holds a1 09:00–10:00; a2 is parked, still holding 14:00–15:00.
    const parked = tripDetailFixture({ ...river, days: [{ dayId: DAY_1, activityIds: [A1], date: null, costSubtotal: 0 }], backlog: [A2] });

    it("is placed at the time it was dropped, onto the day", () => {
      expect(resolveDrop(parked, { activityId: A2 }, at("08:00", "09:00"))).toEqual({
        kind: "place",
        activityId: A2,
        toDayId: DAY_1,
        position: 0,
        timeWindow: { start: "08:00", end: "09:00" },
      });
    });

    it("goes onto the day and to its time as one batch, the move first", () => {
      const outcome = resolveDrop(parked, { activityId: A2 }, at("16:00", "17:00"));
      expect(outcome?.kind === "place" && placeCommands("t", outcome)).toEqual([
        { type: "MoveActivity", tripId: "t", activityId: A2, toDayId: DAY_1, position: 1 },
        { type: "UpdateActivity", tripId: "t", activityId: A2, timeWindow: { start: "16:00", end: "17:00" } },
      ]);
    });
  });
});
