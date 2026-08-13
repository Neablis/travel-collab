import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SPARKLINE_PALETTE, UNKNOWN_CITY_COLOR } from "@/lib/sparklineColor";
import { CHART_HEIGHT_PX, Sparkline, blockMetricsFor, citySegmentsFor, shapeOf } from "./Sparkline";

afterEach(cleanup);

describe("shapeOf", () => {
  it("emits one day group per day, carrying that day's stop count", () => {
    const groups = shapeOf([
      { city: "Rochester", stopCount: 2 },
      { city: "Kyoto", stopCount: 1 },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.blockCount).toBe(2);
    expect(groups[1]!.blockCount).toBe(1);
  });

  // Regression: a day with zero stops used to contribute zero bars and
  // vanish from the sparkline entirely — nothing marked that the day even
  // existed. It must still appear as its own group, just with no blocks.
  it("keeps a day with zero stops as its own (empty) group", () => {
    const groups = shapeOf([
      { city: "Rochester", stopCount: 1 },
      { city: null, stopCount: 0 },
      { city: "Kyoto", stopCount: 1 },
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[1]!.blockCount).toBe(0);
    expect(groups[1]!.dayLabel).toBe(2);
  });

  it("labels every day by its 1-indexed position in the trip", () => {
    const groups = shapeOf([
      { city: "Rochester", stopCount: 1 },
      { city: "Rochester", stopCount: 1 },
      { city: "Niagara Falls", stopCount: 1 },
    ]);
    expect(groups.map((group) => group.dayLabel)).toEqual([1, 2, 3]);
  });

  // Regression: the sparkline used to key its accent by day index, so the
  // same real city got a different color on different days (e.g. a 3-day
  // Rochester trip). Every group for a day must use that day's own real
  // city.
  it("colors every day's group by that day's own city, not its index", () => {
    const groups = shapeOf([
      { city: "Rochester", stopCount: 1 },
      { city: "Kyoto", stopCount: 1 },
      { city: "Rochester", stopCount: 1 },
    ]);
    expect(groups[0]!.color).toBe(groups[2]!.color);
    expect(groups[0]!.color).not.toBe(groups[1]!.color);
  });

  // Regression: colors were hashed per city independently of the trip, so
  // three cities on one real 14-day trip (Tokyo/Hakone/Kyoto) all drew the
  // same orange — on a graph where color is the only city signal, that reads
  // as one continuous city.
  it("gives every city on a trip a distinct color, up to the palette's size", () => {
    const groups = shapeOf(
      ["Tokyo", "Nikkō", "Hakone", "Kyoto", "Osaka", "Naoshima"].map((city) => ({ city, stopCount: 1 })),
    );
    expect(new Set(groups.map((group) => group.color)).size).toBe(6);
  });

  it("gives a day with no known city a neutral, not a palette hue", () => {
    const groups = shapeOf([
      { city: "Tokyo", stopCount: 1 },
      { city: null, stopCount: 1 },
    ]);
    expect(groups[1]!.color).toBe(UNKNOWN_CITY_COLOR);
    expect(new Set<string>(SPARKLINE_PALETTE)).not.toContain(groups[1]!.color);
  });
});

describe("blockMetricsFor", () => {
  it("caps a block at 20px so a sparse trip renders blocks, not slabs", () => {
    // 96px split two ways would be a 45px block without the ceiling.
    expect(blockMetricsFor(2).blockHeight).toBe(20);
    expect(blockMetricsFor(2).gap).toBe(6);
  });

  it("scales blocks down to fit the fixed chart height once the cap stops binding", () => {
    const { blockHeight, gap } = blockMetricsFor(12);
    expect(blockHeight).toBeLessThan(20);
    expect(blockHeight).toBeGreaterThan(0);
    // The whole column (blocks plus the gaps between them) still fits the
    // drawing area, which is the point of scaling at all.
    expect(12 * blockHeight + 11 * gap).toBeLessThanOrEqual(CHART_HEIGHT_PX);
  });

  it("floors a block at 2px so an extremely packed day still shows every stop", () => {
    expect(blockMetricsFor(60).blockHeight).toBe(2);
  });

  it("returns zero geometry for a trip with no stops at all", () => {
    expect(blockMetricsFor(0)).toEqual({ blockHeight: 0, gap: 0 });
  });
});

describe("citySegmentsFor", () => {
  it("lists every distinct city once, with a stop count across the whole trip", () => {
    const segments = citySegmentsFor([
      { city: "Tokyo", stopCount: 2 },
      { city: "Tokyo", stopCount: 1 },
      { city: "Kyoto", stopCount: 1 },
    ]);
    expect(segments.map((s) => s.label)).toEqual(["Tokyo · 3", "Kyoto · 1"]);
  });

  // A city revisited later in the trip (a return leg) is still one line
  // with a combined count, not a separate entry per visit.
  it("combines a city's stops even when it's revisited non-contiguously", () => {
    const segments = citySegmentsFor([
      { city: "Tokyo", stopCount: 1 },
      { city: "Nikkō", stopCount: 2 },
      { city: "Tokyo", stopCount: 1 },
    ]);
    expect(segments.map((s) => s.label)).toEqual(["Tokyo · 2", "Nikkō · 2"]);
  });

  it("skips days with no known city rather than fabricating a label", () => {
    const segments = citySegmentsFor([
      { city: null, stopCount: 1 },
      { city: "Kyoto", stopCount: 1 },
    ]);
    expect(segments.map((s) => s.label)).toEqual(["Kyoto · 1"]);
  });
});

describe("Sparkline", () => {
  // The brief's own worked example: a 4-day trip of 4/2/5/1 activities is
  // four columns of exactly that many blocks, day 3 the tallest and day 4
  // the shortest.
  it("stacks one equal-height block per stop, in one column per day", () => {
    const { container } = render(
      <Sparkline
        days={[
          { city: "Rochester", stopCount: 4 },
          { city: "Rochester", stopCount: 2 },
          { city: "Niagara Falls", stopCount: 5 },
          { city: "Niagara Falls", stopCount: 1 },
        ]}
      />,
    );
    const columns = Array.from(container.querySelectorAll<HTMLElement>("[data-testid='sparkline-day']"));
    expect(columns.map((column) => column.querySelectorAll('[aria-hidden="true"]').length)).toEqual([4, 2, 5, 1]);

    // Every block in the graph is the same height — the column's height is
    // the count, nothing else.
    const heights = new Set(
      Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'), (block) => block.style.height),
    );
    expect(heights.size).toBe(1);
  });

  it("renders a day-number label under every day, including an empty one", () => {
    render(
      <Sparkline
        days={[
          { city: "Rochester", stopCount: 1 },
          { city: null, stopCount: 0 },
          { city: "Kyoto", stopCount: 1 },
        ]}
      />,
    );
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // the empty day still gets its number
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("gives an empty day its own blockless column rather than dropping it", () => {
    const { container } = render(
      <Sparkline
        days={[
          { city: "Rochester", stopCount: 1 },
          { city: null, stopCount: 0 },
        ]}
      />,
    );
    const columns = container.querySelectorAll("[data-testid='sparkline-day']");
    expect(columns).toHaveLength(2);
    expect(columns[1]!.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0);
  });

  it("colors a day's blocks by that day's city", () => {
    const { container } = render(
      <Sparkline
        days={[
          { city: "Kyoto", stopCount: 1 },
          { city: "Osaka", stopCount: 1 },
        ]}
      />,
    );
    const [kyoto, osaka] = Array.from(
      container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'),
      (block) => block.style.backgroundColor,
    );
    // jsdom re-serializes the palette's hex into its own channel notation,
    // so round-trip the expected color through a probe element rather than
    // comparing against the hex string directly.
    const probe = document.createElement("span");
    probe.style.backgroundColor = SPARKLINE_PALETTE[0];
    expect(kyoto).toBe(probe.style.backgroundColor);
    expect(osaka).not.toBe(kyoto);
  });

  it("renders a city-segment pill list below the blocks", () => {
    render(
      <Sparkline
        days={[
          { city: "Tokyo", stopCount: 1 },
          { city: "Tokyo", stopCount: 1 },
          { city: "Kyoto", stopCount: 1 },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Cities visited" });
    expect(screen.getByText("Tokyo · 2")).toBeTruthy();
    expect(screen.getByText("Kyoto · 1")).toBeTruthy();
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  });

  it("omits the city-segment row entirely when no day has a known city", () => {
    render(<Sparkline days={[{ city: null, stopCount: 0 }]} />);
    expect(screen.queryByRole("list", { name: "Cities visited" })).toBeNull();
  });

  it("exposes the whole strip as one labeled group, not per-block controls", () => {
    render(<Sparkline days={[{ city: "Rochester", stopCount: 1 }]} />);
    expect(screen.getByRole("group", { name: "Shape of the trip" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
