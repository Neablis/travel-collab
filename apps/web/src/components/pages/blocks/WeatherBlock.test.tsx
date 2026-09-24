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

const dataRows = () => screen.getAllByRole("row").filter((row) => row.hasAttribute("data-mode"));

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
    const rows = dataRows();
    expect(rows.map((row) => row.getAttribute("data-mode"))).toEqual(["past", "today", "forecast", "typical"]);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0]!.textContent)).toEqual([
      "Past day · Nov avg",
      "Today · Cloudy",
      "Forecast · Light rain",
      "November average",
    ]);
    // Under a "Now" heading the value needs no word of its own.
    expect(within(rows[1]!).getByRole("cell", { name: "now" }).textContent).toBe("12°");
  });

  // Mitchell, on the #221 preview: *"I have no idea what the columns are
  // without a column header. But might be good to make that a toggle."*
  it("heads its columns by default, and says 'now' in the cell when the headings are off", () => {
    const weather = { points: [point(TODAY), point("2026-11-13")] };
    view(trip(), weather);
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day", "Conditions", "Now", "High", "Low", "Rain",
    ]);
    cleanup();
    view(trip(), weather, false, { params: { headings: false } });
    expect(screen.queryAllByRole("columnheader")).toEqual([]);
    expect(within(dataRows()[0]!).getByRole("cell", { name: "now" }).textContent).toBe("now 12°");
  });

  // *"We need to scroll to the right to see all the data here."* A column no
  // row fills is width the conditions cell could have had.
  it("drops the 'now' column, heading and cells, when no row has a value for it", () => {
    view(trip(), { points: [point("2026-11-13"), point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } })] });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day", "Conditions", "High", "Low", "Rain",
    ]);
    for (const row of dataRows()) expect(within(row).queryByRole("cell", { name: "now" })).toBeNull();
  });

  // *"Make sure we are respecting the account settings for fahrenheit vs
  // celsius, or metric vs imperial."* The account's `distanceUnit` reaches the
  // block through MacroView's `user`, the same prop every widget reads.
  it("reads °F and inches for an account in miles", () => {
    const miles: UserPreferences = { displayName: null, homeAirport: null, distanceUnit: "mi" };
    view(trip(), { points: [point("2026-11-13")] }, false, { user: miles });
    const [row] = dataRows();
    expect(within(row!).getByRole("cell", { name: "high" }).textContent).toBe("64°");
    expect(within(row!).getByRole("cell", { name: "rain" }).textContent).toBe("0.08 in");
  });

  // Mitchell, on the #221 preview: a longer date wrapped the header out of its
  // fixed-height row. The row names its day and nothing else; a reader who
  // wants the dates puts them at the top of the page.
  it("heads each row with its place and day, never the date", () => {
    view(trip(), { points: [point("2026-11-09"), point(TODAY)] });
    // A header's lines are its accessible text, in order; the date is gone
    // from both. (Staying on one line is layout — the preview walk's to see.)
    expect(screen.getAllByRole("rowheader").map((h) => h.textContent)).toEqual(["KyotoDay 1", "KyotoDay 2"]);
  });

  // Mitchell, on the PR 221 preview: *"I dont understand what this section is?
  // Typical lines? are they needed?"* The credits are required (ADR-052
  // decision 5), so they stay — as ONE plain line naming what each source's
  // data is on the block, with the as-of and the period beside their source.
  it("credits its sources on one plain line: the forecast with its licence link and as-of, the averages with their period", () => {
    view(trip(), { points: [point(TODAY), point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } })] });
    const sources = screen.getByRole("note", { name: "Weather sources" });
    expect(sources.textContent).toMatch(
      /^Forecast: Norwegian Meteorological Institute, CC BY 4\.0 \(updated \d{1,2}(:\d\d)? (am|pm)\) · Monthly averages: NASA POWER, 2001–2020$/,
    );
    const met = within(sources).getByRole("link", { name: "Norwegian Meteorological Institute, CC BY 4.0" });
    expect(met.getAttribute("href")).toBe("https://api.met.no/doc/License");
  });

  it("names only the sources on the block: averages alone carry no forecast credit", () => {
    view(trip(), { points: [point("2026-11-30", { forecast: { unavailable: "not-in-horizon" } })] });
    expect(screen.getByRole("note", { name: "Weather sources" }).textContent).toBe(
      "Monthly averages: NASA POWER, 2001–2020",
    );
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

// Mitchell, on the #221 preview: *"All times should be in AM/PM not military
// time."* The house clock (`toClockLabel`), never a second format.
describe("asOfText", () => {
  it("says the time alone for today, and the date too when it is older, on a 12-hour clock", () => {
    expect(asOfText(new Date(2026, 10, 10, 9, 10).toISOString(), TODAY)).toBe("updated 9:10 am");
    expect(asOfText(new Date(2026, 10, 10, 13, 0).toISOString(), TODAY)).toBe("updated 1 pm");
    expect(asOfText(new Date(2026, 10, 9, 21, 5).toISOString(), TODAY)).toBe("updated Mon, Nov 9, 9:05 pm");
  });
});
