import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripDetail, TripGlobals } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { MacroView } from "../MacroView";

// "Sunrise and sunset" (M14 link 11) end to end in the browser half: a trip
// and its globals projection, through the real `day.sun` resolver and
// `MacroView` into the block. The sun is arithmetic on a place and a date, so
// there is no clock to pin and no source to stub.

afterEach(cleanup);

const TOKYO = { lat: 35.6812, lng: 139.7671, city: "Tokyo" };
const LONGYEARBYEN = { lat: 78.22, lng: 15.65, city: "Longyearbyen" };

// Tokyo at the March equinox, then Longyearbyen under the midnight sun and in
// the polar night: one row in each state the block draws.
const DAYS = [
  { date: "2026-03-20", place: TOKYO, timeZone: "Asia/Tokyo" },
  { date: "2026-06-21", place: LONGYEARBYEN, timeZone: "Arctic/Longyearbyen" },
  { date: "2026-12-21", place: LONGYEARBYEN, timeZone: "Arctic/Longyearbyen" },
];

// The globals are a literal, as `time.test.ts` writes them: the projection is
// the server's (`buildTripGlobals`), which a component test may not import.
function located(): { detail: TripDetail; globals: TripGlobals } {
  const built = tripDetailFactory.build({}, { transient: { dayCount: DAYS.length, activitiesPerDay: 1 } });
  return {
    detail: { ...built, days: built.days.map((day, i) => ({ ...day, date: DAYS[i]!.date })) },
    globals: {
      days: DAYS.map((day, index) => ({ index, ...day, cities: [day.place.city], activityCount: 1, costSubtotal: 0 })),
      cities: [], tags: [], homeTimeZone: null,
    },
  };
}

const view = (params: Record<string, unknown> = {}) => {
  const { detail, globals } = located();
  return render(
    <MacroView detail={detail} context={{ tripId: detail.tripId }} globals={globals} name="day.sun" params={params} />,
  );
};

// A day's row in either view: the table's heading row is the one that holds
// column headers, and the graphic's tick row is hidden from roles.
const dataRows = () =>
  screen.getAllByRole("row").filter((row) => within(row).queryAllByRole("columnheader").length === 0);
const cellsOf = (row: HTMLElement) =>
  ["sunrise", "sunset", "daylight"].map((name) => within(row).getByRole("cell", { name }).textContent);

describe("the sun block", () => {
  // The graphic is what an absent `view` means, so a `day.sun` saved when the
  // widget was a line of text draws it. The ribbon is presentation; the three
  // values beside it are what a reader is told.
  it("draws a row per day by default: its city over its day, and the payload's sunrise, sunset and daylight", () => {
    view();
    expect(screen.getByRole("table", { name: "Sunrise and sunset for 3 days." })).toBeTruthy();
    const [tokyo] = dataRows();
    expect(within(tokyo!).getByRole("rowheader").textContent).toBe("TokyoDay 1");
    const [sunrise, sunset, daylight] = cellsOf(tokyo!);
    expect(sunrise).toMatch(/^5:4\d am$/);
    expect(sunset).toMatch(/^5:5\d pm$/);
    expect(daylight).toMatch(/^12h \d+m$/);
    expect(within(tokyo!).getAllByTestId("sun-ribbon")).toHaveLength(1);
    expect(screen.queryAllByRole("columnheader")).toEqual([]);
  });

  // A polar day has no two times to print, so the row says which it is in
  // words where the sunrise would be. `data-state` is the fact the ribbon is
  // drawn from: across the whole axis, or not at all.
  it("says a polar day in words, and draws its ribbon full or not at all", () => {
    view();
    const rows = dataRows();
    expect(rows.map((row) => row.getAttribute("data-state"))).toEqual(["normal", "up-all-day", "down-all-day"]);
    expect(cellsOf(rows[1]!)).toEqual(["sun up all day", "", "24h"]);
    expect(cellsOf(rows[2]!)).toEqual(["sun down all day", "", "0h"]);
    expect(within(rows[1]!).getAllByTestId("sun-ribbon")).toHaveLength(1);
    expect(within(rows[2]!).queryByTestId("sun-ribbon")).toBeNull();
  });

  it("as a table, heads Day, City, Sunrise, Sunset and Daylight over the same rows", () => {
    view({ view: "table" });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day", "City", "Sunrise", "Sunset", "Daylight",
    ]);
    const rows = dataRows();
    expect(rows.map((row) => within(row).getByRole("rowheader").textContent)).toEqual(["Day 1", "Day 2", "Day 3"]);
    expect(cellsOf(rows[0]!)[0]).toMatch(/^5:4\d am$/);
    // A polar row's words take the Sunrise cell and leave a dash in Sunset.
    expect(cellsOf(rows[1]!)).toEqual(["sun up all day", "—", "24h"]);
    expect(cellsOf(rows[2]!)).toEqual(["sun down all day", "—", "0h"]);
    expect(screen.queryAllByTestId("sun-ribbon")).toEqual([]);
  });
});
