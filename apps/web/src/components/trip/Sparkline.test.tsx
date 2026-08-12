import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sparklineColorFor } from "@/lib/sparklineColor";
import { Sparkline, shapeOf } from "./Sparkline";

afterEach(cleanup);

describe("shapeOf", () => {
  it("emits one bar per stop, across all days, in order", () => {
    const bars = shapeOf([
      { city: "Rochester", stops: [{ durationMinutes: 30 }, { durationMinutes: 60 }] },
      { city: "Kyoto", stops: [{ durationMinutes: 120 }] },
    ]);
    expect(bars).toHaveLength(3);
  });

  it("normalizes height against the trip's longest stop, flooring short stops at 35%", () => {
    const bars = shapeOf([
      {
        city: "Rochester",
        stops: [{ durationMinutes: 20 }, { durationMinutes: 240 }, { durationMinutes: 5 }],
      },
    ]);
    expect(bars[0]!.heightPct).toBe(35); // 20/240 ~8.3%, floored to 35
    expect(bars[1]!.heightPct).toBe(100); // the longest stop itself
    expect(bars[2]!.heightPct).toBe(35); // 5/240 ~2%, floored
  });

  it("floors every bar when nothing in the trip has a real duration", () => {
    const bars = shapeOf([{ city: "Rochester", stops: [{ durationMinutes: null }, { durationMinutes: null }] }]);
    expect(bars.every((b) => b.heightPct === 35)).toBe(true);
  });

  it("marks breakBefore only on the first stop of a day after the first", () => {
    const bars = shapeOf([
      { city: "Rochester", stops: [{ durationMinutes: 30 }, { durationMinutes: 30 }] },
      { city: "Kyoto", stops: [{ durationMinutes: 30 }] },
      { city: "Osaka", stops: [{ durationMinutes: 30 }, { durationMinutes: 30 }] },
    ]);
    expect(bars.map((b) => b.breakBefore)).toEqual([false, false, true, true, false]);
  });

  // Regression: the sparkline used to key its accent by day index, so the
  // same real city got a different color on different days (e.g. a 3-day
  // Rochester trip). Every bar in a day must use that day's own real city.
  it("colors every bar in a day by that day's own city, not its index", () => {
    const bars = shapeOf([
      { city: "Rochester", stops: [{ durationMinutes: 30 }] },
      { city: "Kyoto", stops: [{ durationMinutes: 30 }] },
      { city: "Rochester", stops: [{ durationMinutes: 30 }] },
    ]);
    expect(bars[0]!.color).toBe(sparklineColorFor("Rochester"));
    expect(bars[2]!.color).toBe(sparklineColorFor("Rochester"));
    expect(bars[0]!.color).toBe(bars[2]!.color);
  });
});

describe("Sparkline", () => {
  it("renders one bar per stop", () => {
    const { container } = render(
      <Sparkline
        days={[
          { city: "Rochester", stops: [{ durationMinutes: 30 }, { durationMinutes: 60 }] },
          { city: "Kyoto", stops: [{ durationMinutes: 90 }] },
        ]}
      />,
    );
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  it("exposes the whole strip as one labeled group, not per-bar controls", () => {
    render(<Sparkline days={[{ city: "Rochester", stops: [{ durationMinutes: 30 }] }]} />);
    expect(screen.getByRole("group", { name: "Shape of the trip" })).toBeTruthy();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
