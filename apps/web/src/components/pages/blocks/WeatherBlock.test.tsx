import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripDetail, TripWeather, TripWeatherPoint } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { MacroView } from "../MacroView";
import { asOfText } from "./WeatherBlock";

// "Weather" (M14 link 11) end to end in the browser half: a `TripWeather` as
// the route answers it, through the real `day.weather` resolver and `MacroView`
// into the block. The mode is chosen from the reader's date, so the clock is
// pinned — to the afternoon, so no zone the suite runs in moves the date.

const TODAY = "2026-11-10";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 10, 10, 14, 0));
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

const DATES = ["2026-11-09", TODAY, "2026-11-13", "2026-11-30"];

function trip(): TripDetail {
  const built = tripDetailFactory.build({}, { transient: { dayCount: DATES.length, activitiesPerDay: 1 } });
  return { ...built, days: built.days.map((day, i) => ({ ...day, date: DATES[i]! })) };
}

const TYPICAL = {
  source: "nasa-power", month: 11, highC: 13.2, lowC: 4.4, precipitationMmPerDay: 3.46,
  period: { fromYear: 2001, throughYear: 2020 },
} as const;
const forecast = (asOf: string) => ({
  source: "met-norway" as const, asOf, highC: 17.6, lowC: 8.2, precipitationMm: 2.14, symbol: "lightrain_day",
  hours: [{ at: `${TODAY}T15:00:00Z`, tempC: 12.4, precipitationMm: 0.2, symbol: "cloudy" }],
});
const point = (date: string, over: Partial<TripWeatherPoint> = {}): TripWeatherPoint => ({
  date, city: "Kyoto", forecast: forecast(`${TODAY}T09:10:00Z`), typical: TYPICAL, ...over,
});

const view = (detail: TripDetail, weather: TripWeather, editing = false) =>
  render(
    <MacroView
      detail={detail} context={{ tripId: detail.tripId }} name="day.weather" params={{}} editing={editing}
      external={{ weather: { state: "ready", value: weather } }}
    />,
  );

describe("the weather block", () => {
  it("renders all four date-driven modes, each naming itself in words", () => {
    view(trip(), {
      points: [
        point("2026-11-09"),
        point(TODAY),
        point("2026-11-13"),
        point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } }),
      ],
    });
    const rows = screen.getAllByRole("row");
    expect(rows.map((row) => row.getAttribute("data-mode"))).toEqual(["past", "today", "forecast", "typical"]);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual([
      "Typical for November — not what it was",
      "Today · Cloudy",
      "Forecast · Light rain",
      "Typical for November",
    ]);
    expect(within(rows[1]!).getByRole("cell", { name: "now" }).textContent).toBe("now 12°");
  });

  it("credits MET Norway with its licence link, and NASA POWER when typical is shown, under an as-of line", () => {
    view(trip(), { points: [point(TODAY), point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } })] });
    const met = screen.getByRole("link", { name: "Forecast: The Norwegian Meteorological Institute (MET Norway), CC BY 4.0" });
    expect(met.getAttribute("href")).toBe("https://api.met.no/doc/License");
    expect(screen.getByText("Typical: NASA Langley Research Center POWER Project")).toBeTruthy();
    expect(screen.getByText("Typical: 2001–2020 averages")).toBeTruthy();
    expect(screen.getByText(/^Forecast as of \d\d:\d\d$/)).toBeTruthy();
  });

  // The gate box's placeholder, from the body the route sends when both ports
  // fail (`weather/route.int.test.ts` proves the route sends exactly this).
  it("is the quiet placeholder when neither source answered — in Reading and in Editing", () => {
    const down: TripWeather = {
      points: DATES.map((date) => point(date, { forecast: { unavailable: "source" }, typical: { unavailable: "source" } })),
    };
    view(trip(), down);
    expect(screen.getByText("weather unavailable")).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    view(trip(), down, true);
    expect(screen.getByText("weather unavailable")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("asOfText", () => {
  it("says the time alone for today, and the date too when it is older", () => {
    expect(asOfText(new Date(2026, 10, 10, 9, 10).toISOString(), TODAY)).toBe("Forecast as of 09:10");
    expect(asOfText(new Date(2026, 10, 9, 21, 5).toISOString(), TODAY)).toMatch(/^Forecast as of .*9.*21:05$/);
  });
});
