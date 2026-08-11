import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { dayAccentFor } from "@/lib/dayAccent";
import { Sparkline, sparklineBars } from "./Sparkline";

afterEach(cleanup);

describe("sparklineBars", () => {
  it("emits one column per day with a bar per stop", () => {
    const bars = sparklineBars([
      { stops: 2, city: "Rochester" },
      { stops: 0, city: null },
      { stops: 4, city: "Kyoto" },
    ]);
    expect(bars.map((c) => c.length)).toEqual([2, 0, 4]);
  });
});

describe("Sparkline", () => {
  it("renders one clickable column per day", () => {
    render(
      <Sparkline
        days={[
          { stops: 1, city: "Rochester" },
          { stops: 3, city: "Kyoto" },
        ]}
        onSelectDay={() => {}}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  // Regression: the accent used to be keyed by day index, so the same city
  // on two different days (e.g. a 3-day Rochester trip) rendered two
  // different colors. It must be keyed by city, matching TripCard/DayChips/
  // Board/CalendarLens, which all key dayAccentFor by city already.
  it("gives the same city the same accent color regardless of which day it falls on", () => {
    render(
      <Sparkline
        days={[
          { stops: 1, city: "Rochester" },
          { stops: 2, city: "Kyoto" },
          { stops: 1, city: "Rochester" },
        ]}
        onSelectDay={() => {}}
      />,
    );
    const [day1, , day3] = screen.getAllByRole("button");
    const rochesterAccent = dayAccentFor("Rochester").solid;
    expect(day1!.querySelector("span")!.className).toContain(`bg-${rochesterAccent}`);
    expect(day3!.querySelector("span")!.className).toContain(`bg-${rochesterAccent}`);
  });
});
