import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sparklineColorFor } from "@/lib/sparklineColor";
import { Sparkline, citySegmentsFor, shapeOf } from "./Sparkline";

afterEach(cleanup);

describe("shapeOf", () => {
  it("emits one day group per day, each with one bar per stop", () => {
    const groups = shapeOf([
      { city: "Rochester", dayNumber: 6, stops: [{ durationMinutes: 30 }, { durationMinutes: 60 }] },
      { city: "Kyoto", dayNumber: 7, stops: [{ durationMinutes: 120 }] },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.bars).toHaveLength(2);
    expect(groups[1]!.bars).toHaveLength(1);
  });

  // Regression: a day with zero stops used to contribute zero bars and
  // vanish from the sparkline entirely — nothing marked that the day even
  // existed. It must still appear as its own group, just with no bars.
  it("keeps a day with zero stops as its own (empty) group", () => {
    const groups = shapeOf([
      { city: "Rochester", dayNumber: 6, stops: [{ durationMinutes: 30 }] },
      { city: null, dayNumber: 7, stops: [] },
      { city: "Kyoto", dayNumber: 8, stops: [{ durationMinutes: 30 }] },
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[1]!.bars).toHaveLength(0);
    expect(groups[1]!.dayNumber).toBe(7);
  });

  it("normalizes height against the trip's longest stop, flooring short stops at 35%", () => {
    const groups = shapeOf([
      {
        city: "Rochester",
        dayNumber: 1,
        stops: [{ durationMinutes: 20 }, { durationMinutes: 240 }, { durationMinutes: 5 }],
      },
    ]);
    const bars = groups[0]!.bars;
    expect(bars[0]!.heightPct).toBe(35); // 20/240 ~8.3%, floored to 35
    expect(bars[1]!.heightPct).toBe(100); // the longest stop itself
    expect(bars[2]!.heightPct).toBe(35); // 5/240 ~2%, floored
  });

  it("floors every bar when nothing in the trip has a real duration", () => {
    const groups = shapeOf([{ city: "Rochester", dayNumber: 1, stops: [{ durationMinutes: null }, { durationMinutes: null }] }]);
    expect(groups[0]!.bars.every((b) => b.heightPct === 35)).toBe(true);
  });

  // Regression: the sparkline used to key its accent by day index, so the
  // same real city got a different color on different days (e.g. a 3-day
  // Rochester trip). Every group for a day must use that day's own real
  // city.
  it("colors every day's group by that day's own city, not its index", () => {
    const groups = shapeOf([
      { city: "Rochester", dayNumber: 1, stops: [{ durationMinutes: 30 }] },
      { city: "Kyoto", dayNumber: 2, stops: [{ durationMinutes: 30 }] },
      { city: "Rochester", dayNumber: 3, stops: [{ durationMinutes: 30 }] },
    ]);
    expect(groups[0]!.color).toBe(sparklineColorFor("Rochester"));
    expect(groups[2]!.color).toBe(sparklineColorFor("Rochester"));
    expect(groups[0]!.color).toBe(groups[2]!.color);
  });

  it("shows a dash when a day has no set date", () => {
    const groups = shapeOf([{ city: "Rochester", dayNumber: null, stops: [] }]);
    expect(groups[0]!.dayNumber).toBeNull();
  });
});

describe("citySegmentsFor", () => {
  it("groups contiguous same-city days into one segment", () => {
    const segments = citySegmentsFor([
      { city: "Tokyo", dayNumber: 1, stops: [] },
      { city: "Tokyo", dayNumber: 2, stops: [] },
      { city: "Kyoto", dayNumber: 3, stops: [] },
    ]);
    expect(segments.map((s) => s.label)).toEqual(["Tokyo · 2 nights", "Kyoto day trip"]);
  });

  it("re-segments when the same city reappears non-contiguously (a return trip)", () => {
    const segments = citySegmentsFor([
      { city: "Tokyo", dayNumber: 1, stops: [] },
      { city: "Nikkō", dayNumber: 2, stops: [] },
      { city: "Tokyo", dayNumber: 3, stops: [] },
    ]);
    expect(segments.map((s) => s.label)).toEqual(["Tokyo day trip", "Nikkō day trip", "Tokyo day trip"]);
  });

  it("skips days with no known city rather than fabricating a label", () => {
    const segments = citySegmentsFor([
      { city: null, dayNumber: 1, stops: [] },
      { city: "Kyoto", dayNumber: 2, stops: [] },
    ]);
    expect(segments.map((s) => s.label)).toEqual(["Kyoto day trip"]);
  });
});

describe("Sparkline", () => {
  it("renders one bar per stop, grouped by day", () => {
    const { container } = render(
      <Sparkline
        days={[
          { city: "Rochester", dayNumber: 1, stops: [{ durationMinutes: 30 }, { durationMinutes: 60 }] },
          { city: "Kyoto", dayNumber: 2, stops: [{ durationMinutes: 90 }] },
        ]}
      />,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it("renders a day-number label under every day, including an empty one, with a dash for no date", () => {
    render(
      <Sparkline
        days={[
          { city: "Rochester", dayNumber: 6, stops: [{ durationMinutes: 30 }] },
          { city: null, dayNumber: null, stops: [] },
          { city: "Kyoto", dayNumber: 8, stops: [{ durationMinutes: 30 }] },
        ]}
      />,
    );
    expect(screen.getByText("6")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("renders a city-segment pill list below the bars", () => {
    render(
      <Sparkline
        days={[
          { city: "Tokyo", dayNumber: 1, stops: [{ durationMinutes: 30 }] },
          { city: "Tokyo", dayNumber: 2, stops: [{ durationMinutes: 30 }] },
          { city: "Kyoto", dayNumber: 3, stops: [{ durationMinutes: 30 }] },
        ]}
      />,
    );
    const list = screen.getByRole("list", { name: "Cities visited" });
    expect(screen.getByText("Tokyo · 2 nights")).toBeTruthy();
    expect(screen.getByText("Kyoto day trip")).toBeTruthy();
    expect(list.querySelectorAll('[role="listitem"]')).toHaveLength(2);
  });

  it("omits the city-segment row entirely when no day has a known city", () => {
    render(<Sparkline days={[{ city: null, dayNumber: 1, stops: [] }]} />);
    expect(screen.queryByRole("list", { name: "Cities visited" })).toBeNull();
  });

  it("exposes the whole strip as one labeled group, not per-bar controls", () => {
    render(<Sparkline days={[{ city: "Rochester", dayNumber: 1, stops: [{ durationMinutes: 30 }] }]} />);
    expect(screen.getByRole("group", { name: "Shape of the trip" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
