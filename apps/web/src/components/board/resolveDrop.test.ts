import { describe, expect, it } from "vitest";
import { attachClosestEdge } from "@atlaskit/pragmatic-drag-and-drop-hitbox/closest-edge";
import { tripDetailFixture } from "@tc/factories";
import { resolveDrop } from "./resolveDrop";

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
    cost: null,
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
