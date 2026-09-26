import { describe, expect, it } from "vitest";
import {
  doubleClickWindow,
  dropWindow,
  edgeScrollDelta,
  fromTimeWindow,
  resizeEnd,
  sketchCreates,
  sketchWindow,
  stopMinutes,
  toTimeWindow,
} from "./riverGestures";
import type { RiverAxis } from "./riverLayout";

// 8:00–22:00 at 44px an hour: 11px is a quarter hour, 44px an hour.
const axis: RiverAxis = { t0: 8 * 60, t1: 22 * 60, heightPx: 14 * 44 };
const at = (hours: number) => (hours - 8) * 44;
const hm = (h: number, m = 0) => h * 60 + m;

describe("double-click on empty time", () => {
  it("starts an hour-long stop at the quarter hour nearest the pointer", () => {
    // 9:20 rounds to 9:15; 9:25 rounds to 9:30.
    expect(doubleClickWindow(axis, at(9 + 20 / 60))).toEqual({ start: hm(9, 15), end: hm(10, 15) });
    expect(doubleClickWindow(axis, at(9 + 25 / 60))).toEqual({ start: hm(9, 30), end: hm(10, 30) });
  });

  it("keeps the whole hour on the axis at the bottom", () => {
    expect(doubleClickWindow(axis, at(21 + 50 / 60))).toEqual({ start: hm(21), end: hm(22) });
  });
});

describe("drag across empty time", () => {
  it("runs from the press to the pointer, both snapped", () => {
    expect(sketchWindow(axis, at(9), at(10.5))).toEqual({ start: hm(9), end: hm(10, 30) });
  });

  it("sketches upward as well as down", () => {
    expect(sketchWindow(axis, at(11), at(9.5))).toEqual({ start: hm(9, 30), end: hm(11) });
  });

  it("is never shorter than a quarter hour, whichever way it went", () => {
    expect(sketchWindow(axis, at(9), at(9))).toEqual({ start: hm(9), end: hm(9, 15) });
    expect(sketchWindow(axis, at(9), at(9 + 5 / 60))).toEqual({ start: hm(9), end: hm(9, 15) });
  });

  it("stops at midnight going down and at the axis going up", () => {
    expect(sketchWindow(axis, at(21), at(30)).end).toBe(24 * 60);
    expect(sketchWindow(axis, at(9), at(2)).start).toBe(axis.t0);
  });

  it("opens the add sheet from 30 minutes, and not below", () => {
    expect(sketchCreates({ start: hm(9), end: hm(9, 30) })).toBe(true);
    expect(sketchCreates({ start: hm(9), end: hm(9, 15) })).toBe(false);
  });
});

describe("drag a block's bottom edge", () => {
  it("ends the stop at the quarter hour under the pointer", () => {
    expect(resizeEnd(axis, hm(9), at(17.5))).toBe(hm(17, 30));
  });

  it("leaves at least a quarter hour after an unsnapped start", () => {
    expect(resizeEnd(axis, hm(10, 10), at(9))).toBe(hm(10, 25));
  });

  it("never ends past midnight", () => {
    expect(resizeEnd(axis, hm(21), at(40))).toBe(24 * 60);
  });
});

describe("drop a stop on the river", () => {
  it("lands the block's top where it was held from, on a quarter hour, keeping its length", () => {
    // Held 22px (half an hour) down a 90-minute block, released at 14:40:
    // its top is at 14:10, which rounds to 14:15.
    expect(dropWindow(axis, at(14 + 40 / 60), 22, 90)).toEqual({ start: hm(14, 15), end: hm(15, 45) });
  });

  it("fits the whole stop in the day", () => {
    // Two hours can start no later than 22:00.
    expect(dropWindow(axis, at(23.5), 0, 120)).toEqual({ start: hm(22), end: 24 * 60 });
    // Nor above the axis, however far up the block was held.
    expect(dropWindow(axis, at(8.25), 44, 60)).toEqual({ start: hm(8), end: hm(9) });
  });

  it("gives an untimed stop the add sheet's hour, and a timed one its own length", () => {
    expect(stopMinutes(null)).toBe(60);
    expect(stopMinutes({ start: "09:00", end: "11:30" })).toBe(150);
  });

  it("keeps a stop that runs to midnight its whole length when it moves", () => {
    // Stored 22:00–23:59, which is how 22:00 to midnight is saved: two hours.
    const toMidnight = { start: "22:00", end: "23:59" };
    expect(stopMinutes(toMidnight)).toBe(120);
    expect(fromTimeWindow(toMidnight)).toEqual({ start: hm(22), end: 24 * 60 });
  });
});

describe("a held touch near the edge of the screen", () => {
  // A phone's river shows between a 300px header and a rack and tab bar that
  // start at 700px, so the bands are 56px inside those edges.
  const scroll = (y: number) => edgeScrollDelta(y, 300, 700);

  it("scrolls near the edges of the part of the screen the river shows in, faster the deeper, and not in between", () => {
    expect(scroll(500)).toBe(0);
    expect(scroll(360)).toBe(0);
    expect(scroll(640)).toBe(0);
    expect(scroll(340)).toBeLessThan(0);
    expect(scroll(660)).toBeGreaterThan(0);
    expect(scroll(310)).toBeLessThan(scroll(340));
    expect(scroll(690)).toBeGreaterThan(scroll(660));
  });

  it("scrolls at full speed with the finger over the header or the rack", () => {
    expect(scroll(100)).toBe(scroll(300));
    expect(scroll(100)).toBeLessThan(0);
    expect(scroll(800)).toBe(scroll(700));
    expect(scroll(800)).toBeGreaterThan(0);
  });
});

describe("the stored form", () => {
  it("reads midnight as 23:59, the last minute a window can hold", () => {
    expect(toTimeWindow({ start: hm(23), end: 24 * 60 })).toEqual({ start: "23:00", end: "23:59" });
  });
});
