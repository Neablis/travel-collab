import { describe, expect, it } from "vitest";
import type { SavedStop } from "@tc/contracts";
import {
  allLegs,
  allPoints,
  dayGeometry,
  geometryKey,
  playbookGeometry,
  worthDrawing,
} from "./sharedDayGeometry";

function stop(over: Partial<SavedStop> = {}): SavedStop {
  return {
    title: "A stop",
    timeWindow: null,
    location: { name: "A stop", lat: 35.0, lng: 135.0 },
    notes: null,
    anchors: [],
    kind: "activity",
    tags: [],
    cost: null,
    dayIndex: 0,
    ...over,
  } as SavedStop;
}

const at = (lat: number, lng: number, title = "x") => stop({ title, location: { name: title, lat, lng } });
const nowhere = (title = "unlocated") => stop({ title, location: null });

describe("one day's geometry", () => {
  it("draws a leg between each consecutive pair, and none before the first", () => {
    const g = dayGeometry([at(1, 1, "a"), at(2, 2, "b"), at(3, 3, "c")], 0);
    expect(g.points.map((p) => p.title)).toEqual(["a", "b", "c"]);
    expect(g.legs.map((l) => `${l.from.title}->${l.to.title}`)).toEqual(["a->b", "b->c"]);
  });

  it("skips a stop with no location but keeps the list's numbering", () => {
    const g = dayGeometry([at(1, 1, "a"), nowhere(), at(3, 3, "c")], 0);
    expect(g.points.map((p) => p.title)).toEqual(["a", "c"]);
    // "c" is the list's third stop and the map's second pin. The number follows
    // the LIST, because a pin labelled 2 beside a list row labelled 3 is worse
    // than a gap in the pin numbers.
    expect(g.points.map((p) => p.number)).toEqual([1, 3]);
  });

  it("marks a leg that steps over an unlocated stop as not contiguous", () => {
    const g = dayGeometry([at(1, 1, "a"), nowhere(), at(3, 3, "c")], 0);
    expect(g.legs).toHaveLength(1);
    // The line between them is a guess about a route that skipped something,
    // not a leg somebody took — so the map may draw it differently.
    expect(g.legs[0]!.contiguous).toBe(false);
  });

  it("marks an unbroken run as contiguous", () => {
    const g = dayGeometry([at(1, 1), at(2, 2)], 0);
    expect(g.legs[0]!.contiguous).toBe(true);
  });

  it("starts numbering where the scope says, not always at 1", () => {
    expect(dayGeometry([at(1, 1)], 1, 5).points[0]!.number).toBe(5);
  });

  it("draws nothing at all for a day with no located stops", () => {
    const g = dayGeometry([nowhere(), nowhere()], 0);
    expect(g.points).toEqual([]);
    expect(g.legs).toEqual([]);
  });
});

describe("All days merges rather than concatenating", () => {
  const days = [
    { dayIndex: 0, stops: [at(1, 1, "d1a"), at(2, 2, "d1b")] },
    { dayIndex: 1, stops: [at(3, 3, "d2a"), at(4, 4, "d2b")] },
  ];

  // **The rule this module exists for.** A single pass over all the stops would
  // join `d1b` to `d2a` — a straight line across a night, a fact the map would
  // be inventing. It looks exactly like every other leg, which is why it has to
  // be impossible rather than merely avoided.
  it("never joins the last stop of one day to the first of the next", () => {
    const legs = allLegs(playbookGeometry(days));
    expect(legs.map((l) => `${l.from.title}->${l.to.title}`)).toEqual(["d1a->d1b", "d2a->d2b"]);
    expect(legs.some((l) => l.from.title === "d1b" && l.to.title === "d2a")).toBe(false);
  });

  it("keeps every point, in order, across the days", () => {
    expect(allPoints(playbookGeometry(days)).map((p) => p.title)).toEqual([
      "d1a",
      "d1b",
      "d2a",
      "d2b",
    ]);
  });

  // §33.1: one running number across the whole Playbook in the rollup.
  it("numbers continuously across days by default", () => {
    expect(allPoints(playbookGeometry(days)).map((p) => p.number)).toEqual([1, 2, 3, 4]);
  });

  it("restarts each day at 1 when the scope is one day", () => {
    const geometry = playbookGeometry(days, { continuousNumbering: false });
    expect(allPoints(geometry).map((p) => p.number)).toEqual([1, 2, 1, 2]);
  });

  // An empty interior day must not shift the numbering of the days after it —
  // it still occupies its own stops' worth of the count, which is none.
  it("carries a rest day without renumbering what follows", () => {
    const withRest = [
      { dayIndex: 0, stops: [at(1, 1, "a"), at(2, 2, "b")] },
      { dayIndex: 1, stops: [] },
      { dayIndex: 2, stops: [at(3, 3, "c")] },
    ];
    expect(allPoints(playbookGeometry(withRest)).map((p) => p.number)).toEqual([1, 2, 3]);
    expect(allLegs(playbookGeometry(withRest)).some((l) => l.from.title === "b")).toBe(false);
  });
});

describe("when the map is worth drawing at all", () => {
  // §16: below two located stops the surface degrades to list-only rather than
  // rendering an empty canvas. One pin on a world map tells a reader less than
  // the city name already in the list.
  it("needs two located stops", () => {
    expect(worthDrawing(playbookGeometry([{ dayIndex: 0, stops: [at(1, 1)] }]))).toBe(false);
    expect(worthDrawing(playbookGeometry([{ dayIndex: 0, stops: [at(1, 1), at(2, 2)] }]))).toBe(true);
  });

  it("counts located stops across days, not within one", () => {
    const split = [
      { dayIndex: 0, stops: [at(1, 1)] },
      { dayIndex: 1, stops: [at(2, 2)] },
    ];
    // Two pins and no legs is still a map worth drawing — it says these two
    // places are far apart, which the list does not.
    expect(worthDrawing(playbookGeometry(split))).toBe(true);
    expect(allLegs(playbookGeometry(split))).toEqual([]);
  });

  it("does not count a stop with no coordinates", () => {
    expect(worthDrawing(playbookGeometry([{ dayIndex: 0, stops: [at(1, 1), nowhere()] }]))).toBe(false);
  });
});

describe("the cache key", () => {
  const days = [
    { dayIndex: 0, stops: [at(1, 1, "a")] },
    { dayIndex: 1, stops: [at(2, 2, "b")] },
  ];

  // **The scope is in the key, and that is the whole point.** Without it,
  // switching from All days to Day 2 leaves the previous day's line on screen:
  // the points are a subset, so nothing about them looks changed.
  it("changes when the scope changes, even over the same Playbook", () => {
    const all = geometryKey("d1", "all", playbookGeometry(days));
    const one = geometryKey("d1", 1, playbookGeometry([days[1]!]));
    expect(all).not.toBe(one);
  });

  it("changes when the Playbook changes", () => {
    const geometry = playbookGeometry(days);
    expect(geometryKey("d1", "all", geometry)).not.toBe(geometryKey("d2", "all", geometry));
  });

  it("is stable for the same scope and the same points", () => {
    expect(geometryKey("d1", "all", playbookGeometry(days))).toBe(
      geometryKey("d1", "all", playbookGeometry(days)),
    );
  });

  it("changes when a coordinate moves", () => {
    const moved = [days[0]!, { dayIndex: 1, stops: [at(2, 2.5, "b")] }];
    expect(geometryKey("d1", "all", playbookGeometry(days))).not.toBe(
      geometryKey("d1", "all", playbookGeometry(moved)),
    );
  });
});
