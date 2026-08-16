import { describe, expect, it } from "vitest";
import { MAP_RAIL_TUNING_DEFAULTS } from "./mapRailTuning";
import { gearedTravel, pickFocusedDay, railScrollGeometry, type RailGeometry, type RailItem } from "./mapRailFocus";

// Real measured values from the live rail: ~95px buttons in a ~600px viewport.
const DAY_HEIGHT = 95;
const VIEWPORT = 600;
const T = MAP_RAIL_TUNING_DEFAULTS;

const items = (count: number): RailItem[] =>
  Array.from({ length: count }, (_, i) => ({ index: i, offsetTop: i * DAY_HEIGHT, height: DAY_HEIGHT }));

/** The rail at a given fraction of its scroll range. */
const at = (count: number, progress: number): RailGeometry => {
  const contentHeight = count * DAY_HEIGHT;
  return {
    items: items(count),
    viewportHeight: VIEWPORT,
    contentHeight,
    offset: Math.max(0, contentHeight - VIEWPORT) * progress,
    progress,
  };
};

const sweepAll = (count: number, tuning = T): number[] => {
  const seen: number[] = [];
  for (let i = 0; i <= 2000; i++) {
    const picked = pickFocusedDay(at(count, i / 2000), tuning);
    if (picked !== null && picked !== seen[seen.length - 1]) seen.push(picked);
  }
  return seen;
};

describe("pickFocusedDay", () => {
  // The regression test for the defect that a fixed centre line cannot reach
  // every day. This is the whole reason the focus line sweeps.
  it("reaches every day, one at a time, across the full scroll range", () => {
    expect(sweepAll(14)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it("reaches every day for short and long trips alike", () => {
    expect(sweepAll(8)).toHaveLength(8);
    expect(sweepAll(30)).toHaveLength(30);
  });

  // Characterisation of the behaviour this design replaces. If this ever starts
  // reaching all 14, the sweep is no longer doing anything and the test above
  // has stopped proving something.
  it("skips days when the focus line is pinned instead of sweeping", () => {
    const fixed = { ...T, focusLineStart: 0.5, focusLineEnd: 0.5 };

    const reached = sweepAll(14, fixed);

    expect(new Set(reached).size).toBeLessThan(14);
  });

  it("focuses the first day at the top of the scroll range", () => {
    expect(pickFocusedDay(at(14, 0), T)).toBe(0);
  });

  it("focuses the last day at the bottom of the scroll range", () => {
    expect(pickFocusedDay(at(14, 1), T)).toBe(13);
  });

  it("returns null when there are no days", () => {
    expect(pickFocusedDay({ ...at(0, 0), items: [] }, T)).toBeNull();
  });

  it("focuses the only day when the rail does not overflow", () => {
    expect(pickFocusedDay(at(3, 0), T)).toBe(0);
  });

  it("never focuses a day scrolled out of the visible band", () => {
    const geometry = at(14, 0.5);

    const picked = pickFocusedDay(geometry, T)!;
    const item = geometry.items[picked]!;

    expect(item.offsetTop + item.height).toBeGreaterThan(geometry.offset);
    expect(item.offsetTop).toBeLessThan(geometry.offset + geometry.viewportHeight);
  });

  it("resolves a tie to the lower day index", () => {
    // Two items equidistant from the focus line; the earlier one wins.
    const geometry: RailGeometry = {
      items: [
        { index: 0, offsetTop: 0, height: 100 },
        { index: 1, offsetTop: 100, height: 100 },
      ],
      viewportHeight: 200,
      contentHeight: 200,
      offset: 0,
      progress: 0.5,
    };

    expect(pickFocusedDay(geometry, { ...T, focusLineStart: 0.5, focusLineEnd: 0.5 })).toBe(0);
  });
});

describe("gearedTravel", () => {
  it("gives one scrollPxPerDay of travel per day change", () => {
    expect(gearedTravel(14, 240)).toBe(13 * 240);
  });

  it("is zero for a single day, which has nothing to scroll to", () => {
    expect(gearedTravel(1, 240)).toBe(0);
    expect(gearedTravel(0, 240)).toBe(0);
  });
});

describe("railScrollGeometry", () => {
  it("maps geared scroll travel onto the natural content offset", () => {
    const geometry = railScrollGeometry({
      scrollTop: 1560, // half of 13 * 240
      viewportHeight: VIEWPORT,
      contentHeight: 14 * DAY_HEIGHT,
      gearedTravel: gearedTravel(14, 240),
    });

    expect(geometry.progress).toBeCloseTo(0.5);
    expect(geometry.offset).toBeCloseTo((14 * DAY_HEIGHT - VIEWPORT) / 2);
  });

  it("clamps past either end of the range", () => {
    const base = { viewportHeight: VIEWPORT, contentHeight: 14 * DAY_HEIGHT, gearedTravel: gearedTravel(14, 240) };

    expect(railScrollGeometry({ ...base, scrollTop: -50 }).progress).toBe(0);
    expect(railScrollGeometry({ ...base, scrollTop: 999_999 }).progress).toBe(1);
  });

  it("falls back to natural travel when gearing is off", () => {
    const geometry = railScrollGeometry({
      scrollTop: 365,
      viewportHeight: VIEWPORT,
      contentHeight: 14 * DAY_HEIGHT,
      gearedTravel: 0,
    });

    expect(geometry.offset).toBeCloseTo(365);
  });

  it("reports no travel when the content fits the viewport", () => {
    expect(
      railScrollGeometry({ scrollTop: 0, viewportHeight: VIEWPORT, contentHeight: 200, gearedTravel: 0 }),
    ).toEqual({ offset: 0, progress: 0 });
  });
});
