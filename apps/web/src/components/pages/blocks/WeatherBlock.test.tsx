import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripDetail, TripWeather, TripWeatherPoint, UserPreferences } from "@tc/contracts";
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
  // Built from local time like the clock: a fixed UTC instant is the day
  // before in a zone west of UTC-9, and the as-of line then prints a date.
  date, city: "Kyoto", forecast: forecast(new Date(2026, 10, 10, 9, 10).toISOString()), typical: TYPICAL, ...over,
});

const view = (
  detail: TripDetail,
  weather: TripWeather,
  editing = false,
  { params = {}, user = null }: { params?: Record<string, unknown>; user?: UserPreferences | null } = {},
) =>
  render(
    <MacroView
      detail={detail} context={{ tripId: detail.tripId }} name="day.weather" params={params} editing={editing}
      user={user} external={{ weather: { state: "ready", value: weather } }}
    />,
  );

// A (day, city) row in either view: the table's heading row is the one that
// holds column headers, and the graphic's tick row is hidden from roles.
const dataRows = () =>
  screen.getAllByRole("row").filter((row) => within(row).queryAllByRole("columnheader").length === 0);
const cellsOf = (row: HTMLElement) =>
  ["high", "low", "rain"].map((name) => within(row).getByRole("cell", { name }).textContent);

const BEYOND = { forecast: { unavailable: "not-in-horizon" } } as const;
const DOWN = { forecast: { unavailable: "source" }, typical: { unavailable: "source" } } as const;

describe("the weather block", () => {
  // The graphic is what an absent `view` means, so every widget already on a
  // page draws it. Forecast and typical differ in line style alone, which is
  // presentation; `data-source` is the fact the style is drawn from.
  it("draws a row per (day, city) by default: the payload's strings, and which source each is", () => {
    view(trip(), { points: [point("2026-11-13"), point("2026-11-30", BEYOND)] });
    const rows = dataRows();
    expect(rows.map((row) => row.getAttribute("data-source"))).toEqual(["forecast", "typical"]);
    expect(rows.map(cellsOf)).toEqual([
      ["18°C", "8°C", "2.14 mm"],
      ["13°C", "4°C", "3.46 mm"],
    ]);
    for (const row of rows) expect(within(row).getAllByTestId("weather-range")).toHaveLength(1);
    // The sky is the forecast's alone: an average has none.
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual([
      "KyotoDay 3 · Light rainForecast",
      "KyotoDay 4Typical",
    ]);
  });

  // Line style is presentation, and a screen reader does not get it: on the
  // default view the row's own header has to say which the numbers are.
  it("names each graphic row's source in its header's accessible name, and says nothing for a row with none", () => {
    view(trip(), { points: [point(TODAY, DOWN), point("2026-11-13"), point("2026-11-30", BEYOND)] });
    const [unknownRow, forecastRow, typicalRow] = dataRows();
    expect(within(forecastRow!).getByRole("rowheader", { name: /Forecast/ })).toBeTruthy();
    expect(within(forecastRow!).queryByRole("rowheader", { name: /Typical/ })).toBeNull();
    expect(within(typicalRow!).getByRole("rowheader", { name: /Typical/ })).toBeTruthy();
    expect(within(unknownRow!).queryByRole("rowheader", { name: /Forecast|Typical/ })).toBeNull();
  });

  it("has no column headers in the graphic, whatever `headings` says", () => {
    view(trip(), { points: [point("2026-11-13")] }, false, { params: { headings: true } });
    expect(screen.queryAllByRole("columnheader")).toEqual([]);
  });

  // Mitchell, on the #221 preview: *"I have no idea what the columns are
  // without a column header. But might be good to make that a toggle."*
  it("as a table, heads Day, City, High, Low, Rain and Source, and says each row's source in a word", () => {
    const weather = { points: [point("2026-11-13"), point("2026-11-30", BEYOND)] };
    view(trip(), weather, false, { params: { view: "table" } });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day", "City", "High", "Low", "Rain", "Source",
    ]);
    const rows = dataRows();
    expect(rows.map((row) => within(row).getByRole("cell", { name: "source" }).textContent)).toEqual([
      "Forecast",
      "Typical",
    ]);
    expect(rows.map(cellsOf)).toEqual([
      ["18°C", "8°C", "2.14 mm"],
      ["13°C", "4°C", "3.46 mm"],
    ]);
    expect(screen.queryAllByTestId("weather-range")).toEqual([]);
    cleanup();
    view(trip(), weather, false, { params: { view: "table", headings: false } });
    expect(screen.queryAllByRole("columnheader")).toEqual([]);
    expect(dataRows()).toHaveLength(2);
  });

  // One (day, city) with neither source, beside one with both: the row keeps
  // its place (ADR-044) and says nothing it does not know.
  it.each(["graphic", "table"] as const)("leaves an unavailable row as dashes with no bar in the %s", (shown) => {
    view(trip(), { points: [point("2026-11-13"), point("2026-11-30", DOWN)] }, false, { params: { view: shown } });
    const [known, unknown] = dataRows();
    expect(cellsOf(known!)).toEqual(["18°C", "8°C", "2.14 mm"]);
    expect(cellsOf(unknown!)).toEqual(["—", "—", "—"]);
    expect(unknown!.hasAttribute("data-source")).toBe(false);
    expect(within(unknown!).queryByTestId("weather-range")).toBeNull();
    if (shown === "table") expect(within(unknown!).getByRole("cell", { name: "source" }).textContent).toBe("—");
  });

  // *"Make sure we are respecting the account settings for fahrenheit vs
  // celsius, or metric vs imperial."* The account's `distanceUnit` reaches the
  // block through MacroView's `user`, the same prop every widget reads.
  it("reads °F and inches for an account in miles", () => {
    const miles: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "mi", timeFormat: "12h", avatar: null, color: null, publicDisplayName: false };
    view(trip(), { points: [point("2026-11-13")] }, false, { user: miles });
    expect(cellsOf(dataRows()[0]!)).toEqual(["64°F", "47°F", "0.08″"]);
  });

  // Mitchell, on the PR 221 preview: *"I dont understand what this section is?
  // Typical lines? are they needed?"* The credits are required (ADR-052
  // decision 5), so they stay — as ONE plain line naming what each source's
  // data is on the block, with the as-of and the period beside their source.
  it("credits its sources on one plain line: the forecast with its licence link and as-of, the averages with their period", () => {
    view(trip(), { points: [point(TODAY), point("2026-11-30", BEYOND)] });
    const sources = screen.getByRole("note", { name: "Weather sources" });
    expect(sources.textContent).toMatch(
      /^Forecast: Norwegian Meteorological Institute, CC BY 4\.0 \(updated \d{1,2}(:\d\d)? (am|pm)\) · Monthly averages: NASA POWER, 2001–2020$/,
    );
    const met = within(sources).getByRole("link", { name: "Norwegian Meteorological Institute, CC BY 4.0" });
    expect(met.getAttribute("href")).toBe("https://api.met.no/doc/License");
  });

  it("names only the sources on the block: averages alone carry no forecast credit", () => {
    view(trip(), { points: [point("2026-11-30", BEYOND)] });
    expect(screen.getByRole("note", { name: "Weather sources" }).textContent).toBe(
      "Monthly averages: NASA POWER, 2001–2020",
    );
  });

  // The gate box's placeholder, from the body the route sends when both ports
  // fail (`weather/route.int.test.ts` proves the route sends exactly this).
  it("is the quiet placeholder when neither source answered — in Reading and in Editing", () => {
    const down: TripWeather = {
      points: DATES.map((date) => point(date, DOWN)),
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

// Mitchell, on the #221 preview: *"All times should be in AM/PM not military
// time"* — and *"maybe a good idea to have that as a setting"*. The house
// clock (`toClockLabel`) in the reader's format, never a second formatter.
describe("asOfText", () => {
  it("says the time alone for today, and the date too when it is older, on a 12-hour clock", () => {
    expect(asOfText(new Date(2026, 10, 10, 9, 10).toISOString(), TODAY, "12h")).toBe("updated 9:10 am");
    expect(asOfText(new Date(2026, 10, 10, 13, 0).toISOString(), TODAY, "12h")).toBe("updated 1 pm");
    expect(asOfText(new Date(2026, 10, 9, 21, 5).toISOString(), TODAY, "12h")).toBe("updated Mon, Nov 9, 9:05 pm");
  });

  it("says the same on a 24-hour clock for a reader who chose one", () => {
    expect(asOfText(new Date(2026, 10, 10, 9, 10).toISOString(), TODAY, "24h")).toBe("updated 09:10");
    expect(asOfText(new Date(2026, 10, 10, 13, 0).toISOString(), TODAY, "24h")).toBe("updated 13:00");
    expect(asOfText(new Date(2026, 10, 9, 21, 5).toISOString(), TODAY, "24h")).toBe("updated Mon, Nov 9, 21:05");
  });
});
