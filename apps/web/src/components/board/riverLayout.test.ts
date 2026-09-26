import { describe, expect, it } from "vitest";
import {
  layoutRiver,
  minuteToPx,
  riverAxis,
  riverTicks,
  riverTier,
  tickLabel,
  type RiverAxis,
  type RiverStop,
} from "./riverLayout";

const w = (start: string, end: string) => ({ start, end });
const stop = (id: string, start: string, end: string): RiverStop => ({ id, window: w(start, end) });
const byId = (placements: ReturnType<typeof layoutRiver>) => Object.fromEntries(placements.map((p) => [p.id, p]));

describe("riverAxis", () => {
  it("runs from the earliest start, floored, to the latest end, ceiled, to the hour", () => {
    const axis = riverAxis([w("09:30", "10:00"), null, w("06:45", "08:00"), w("20:00", "21:10")]);
    expect(axis).toEqual({ t0: 6 * 60, t1: 22 * 60, heightPx: 16 * 44 });
  });

  it("falls back to 8:00–22:00 when nothing on the trip is timed", () => {
    expect(riverAxis([])).toEqual({ t0: 8 * 60, t1: 22 * 60, heightPx: 14 * 44 });
    expect(riverAxis([null, null])).toEqual(riverAxis([]));
  });

  it("stops at midnight rather than running into tomorrow", () => {
    expect(riverAxis([w("22:00", "23:59")]).t1).toBe(24 * 60);
  });

  it("keeps whole hours whole", () => {
    expect(riverAxis([w("09:00", "17:00")])).toMatchObject({ t0: 9 * 60, t1: 17 * 60 });
  });
});

describe("the axis's scale", () => {
  const axis: RiverAxis = { t0: 8 * 60, t1: 22 * 60, heightPx: 14 * 44 };

  it("is 44px an hour from the axis's first minute", () => {
    expect(minuteToPx(axis, 8 * 60)).toBe(0);
    expect(minuteToPx(axis, 9 * 60 + 30)).toBe(66);
  });

  it("ticks every whole hour, both ends included", () => {
    const ticks = riverTicks({ t0: 9 * 60, t1: 12 * 60, heightPx: 132 });
    expect(ticks).toEqual([
      { minute: 540, topPx: 0 },
      { minute: 600, topPx: 44 },
      { minute: 660, topPx: 88 },
      { minute: 720, topPx: 132 },
    ]);
  });
});

describe("layoutRiver", () => {
  const axis = riverAxis([w("08:00", "22:00")]);

  it("draws a stop at its time, to scale, less the gap between neighbours", () => {
    const [block] = layoutRiver(axis, [stop("a", "09:00", "11:00")]);
    expect(block).toMatchObject({ topPx: 44, heightPx: 86, lane: 0, lanes: 1 });
  });

  it("puts the same time at the same height whichever day it is on", () => {
    // Two calls, one per day column, against the one shared axis.
    const day1 = byId(layoutRiver(axis, [stop("a", "09:00", "10:00")]));
    const day5 = byId(layoutRiver(axis, [stop("b", "13:00", "15:00"), stop("c", "09:00", "10:00")]));
    expect(day1.a!.topPx).toBe(day5.c!.topPx);
  });

  it("never draws a block shorter than 24px", () => {
    const [block] = layoutRiver(axis, [stop("a", "09:00", "09:10")]);
    expect(block!.heightPx).toBe(24);
  });

  it("lifts a block the minimum height would push past the end of the axis", () => {
    const [block] = layoutRiver(axis, [stop("a", "21:50", "22:00")]);
    expect(block!.topPx + block!.heightPx).toBe(axis.heightPx);
  });

  it("keeps back-to-back stops in one lane", () => {
    const placed = byId(layoutRiver(axis, [stop("a", "09:00", "10:00"), stop("b", "10:00", "11:00")]));
    expect(placed.a).toMatchObject({ lane: 0, lanes: 1 });
    expect(placed.b).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("splits two overlapping stops into two lanes", () => {
    const placed = byId(layoutRiver(axis, [stop("b", "10:00", "12:00"), stop("a", "09:00", "11:00")]));
    expect(placed.a).toMatchObject({ lane: 0, lanes: 2 });
    expect(placed.b).toMatchObject({ lane: 1, lanes: 2 });
  });

  it("gives three stops that all overlap a lane each, where halves would stack two", () => {
    const placed = byId(
      layoutRiver(axis, [stop("a", "09:00", "12:00"), stop("b", "10:00", "13:00"), stop("c", "11:00", "14:00")]),
    );
    expect(new Set([placed.a!.lane, placed.b!.lane, placed.c!.lane])).toEqual(new Set([0, 1, 2]));
    expect([placed.a!.lanes, placed.b!.lanes, placed.c!.lanes]).toEqual([3, 3, 3]);
  });

  it("reuses a lane once it is free, so a chain of pairs stays at two lanes", () => {
    // a overlaps b, b overlaps c, a and c do not meet: c can take a's lane.
    const placed = byId(
      layoutRiver(axis, [stop("a", "09:00", "10:00"), stop("b", "09:30", "11:00"), stop("c", "10:30", "12:00")]),
    );
    expect(placed.c).toMatchObject({ lane: 0, lanes: 2 });
  });

  it("sizes each cluster on its own — a later lone stop is full width again", () => {
    const placed = byId(
      layoutRiver(axis, [stop("a", "09:00", "11:00"), stop("b", "10:00", "11:00"), stop("c", "15:00", "16:00")]),
    );
    expect(placed.c).toMatchObject({ lane: 0, lanes: 1 });
  });

  it("decides overlap on the drawn box, so a short stop does not hide under the next", () => {
    // 09:00–09:10 is drawn 24px tall and reaches past 09:30's top edge.
    const placed = byId(layoutRiver(axis, [stop("a", "09:00", "09:10"), stop("b", "09:15", "10:00")]));
    expect(placed.a!.lanes).toBe(2);
    expect(placed.b!.lane).not.toBe(placed.a!.lane);
  });
});

describe("riverTier", () => {
  it("shows the title only below 40px, adds time and place from 40px, and tags from 70px", () => {
    expect(riverTier(39)).toBe("compact");
    expect(riverTier(40)).toBe("roomy");
    expect(riverTier(69)).toBe("roomy");
    expect(riverTier(70)).toBe("tall");
  });

  it("is what a placed block carries for its drawn height", () => {
    const axis = riverAxis([]);
    const placed = byId(
      layoutRiver(axis, [stop("half", "09:00", "09:30"), stop("hour", "10:00", "11:00"), stop("two", "12:00", "14:00")]),
    );
    expect([placed.half!.tier, placed.hour!.tier, placed.two!.tier]).toEqual(["compact", "roomy", "tall"]);
  });
});

describe("tickLabel", () => {
  it("prints the reader's clock, compact enough for the gutter", () => {
    expect(tickLabel(9 * 60, "12h")).toBe("9am");
    expect(tickLabel(12 * 60, "12h")).toBe("12pm");
    expect(tickLabel(9 * 60, "24h")).toBe("09:00");
  });

  it("calls the end of the day midnight, not 23:59", () => {
    expect(tickLabel(24 * 60, "12h")).toBe("12am");
    expect(tickLabel(24 * 60, "24h")).toBe("00:00");
  });
});
