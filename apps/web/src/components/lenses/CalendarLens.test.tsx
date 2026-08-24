import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { FocusProvider, useFocus } from "../trip/context/FocusProvider";
import { CalendarLens } from "./CalendarLens";

afterEach(cleanup);

const day1 = "11111111-1111-4111-8111-111111111111";
const rome = "22222222-2222-4222-8222-222222222222";
const forum = "33333333-3333-4333-8333-333333333333";
const flight = "44444444-4444-4444-8444-444444444444";

// Reads focusedDay back out of the same FocusProvider CalendarLens is
// wrapped in — the provider itself has no visible output, so a click's
// effect on setFocusedDay is otherwise unobservable (mirrors
// FocusProvider.test.tsx's Probe pattern).
function FocusProbe() {
  const { focusedDay } = useFocus();
  return <span data-testid="focused-day">{String(focusedDay)}</span>;
}

function renderLens(detail: ReturnType<typeof tripDetailFixture>) {
  return render(
    <FocusProvider>
      <CalendarLens detail={detail} />
      <FocusProbe />
    </FocusProvider>,
  );
}

// A trip whose days hold no stops at all. `calendarCells` pads the grid out to
// whole weeks, so this fixture also supplies the out-of-trip cells the
// empty-day copy must NOT reach.
function detailWithEmptyDay(dayCount = 1) {
  return tripDetailFixture({
    startDate: "2027-06-01",
    days: Array.from({ length: dayCount }, (_, i) => ({
      dayId: `${i}0000000-0000-4000-8000-000000000000`,
      activityIds: [],
      date: `2027-06-0${i + 1}`,
      costSubtotal: 0,
    })),
    activities: {},
  });
}

function detailFixture() {
  return tripDetailFixture({
    startDate: "2027-06-01",
    days: [{ dayId: day1, activityIds: [rome, forum, flight], date: "2027-06-01", costSubtotal: 0 }],
    activities: {
      [rome]: {
        activityId: rome,
        title: "Colosseum tour",
        timeWindow: null,
        location: { name: "Rome" },
        notes: null,
        anchors: [],
        cost: null,
      },
      [forum]: {
        activityId: forum,
        title: "Roman Forum",
        timeWindow: null,
        location: { name: "Rome" },
        notes: null,
        anchors: [],
        cost: null,
      },
      [flight]: {
        activityId: flight,
        title: "Flight home",
        timeWindow: null,
        location: null,
        notes: null,
        anchors: [],
        cost: null,
      },
    },
  });
}

describe("CalendarLens", () => {
  it("renders the 7-column weekday header", () => {
    renderLens(detailFixture());
    const grid = screen.getByRole("grid", { name: "Trip calendar" });
    for (const label of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
      expect(screen.getByText(label)).toBeDefined();
    }
    expect(grid).toBeDefined();
  });

  it("shows the empty state and no grid when the trip has no start date", () => {
    renderLens(tripDetailFixture());
    expect(screen.getByText("Set a start date to see the calendar.")).toBeDefined();
    expect(screen.queryByRole("grid", { name: "Trip calendar" })).toBeNull();
  });

  it("shows Day N, city, first stop, and +N more on an in-trip cell", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    expect(cell).toBeDefined();
    expect(cell.textContent).toContain("Day 1");
    expect(cell.textContent).toContain("Rome");
    expect(cell.textContent).toContain("Colosseum tour");
    // 3 activityIds → 1 shown as first stop, 2 more.
    expect(cell.textContent).toContain("+2 more");
  });

  it("clicking an in-trip cell calls setFocusedDay with the 0-based day index", async () => {
    renderLens(detailFixture());
    await userEvent.click(screen.getByRole("button", { name: /Day 1, Rome/ }));
    // cell.ordinal is 1 (1-based) → setFocusedDay(0).
    expect(screen.getByTestId("focused-day").textContent).toBe("0");
  });

  // The phase file's own Step 1 test for this lens, verbatim.
  it("says nothing is planned on an in-trip day with no stops", () => {
    renderLens(detailWithEmptyDay());
    expect(screen.getByText("Nothing planned yet")).toBeTruthy();
  });

  // The copy belongs to in-trip days only. Out-of-trip cells are the grid's
  // week padding — dimmed date numbers — and must not claim a plan is missing
  // from a day the trip never covered.
  it("leaves out-of-trip cells without the empty-day copy", () => {
    renderLens(detailWithEmptyDay());
    const outOfTrip = screen
      .getAllByTestId("calendar-cell")
      .filter((cell) => cell.getAttribute("data-in-trip") === "false");
    expect(outOfTrip.length).toBeGreaterThan(0);
    for (const cell of outOfTrip) {
      expect(cell.textContent).not.toContain("Nothing planned yet");
    }
    // Exactly one in-trip day, so exactly one instance of the copy.
    expect(screen.getAllByText("Nothing planned yet")).toHaveLength(1);
  });

  it("says it on every day of an all-empty trip", () => {
    renderLens(detailWithEmptyDay(3));
    expect(screen.getAllByText("Nothing planned yet")).toHaveLength(3);
  });

  it("does not say it on a day that has stops", () => {
    renderLens(detailFixture());
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  // A trip with no days at all has no start date in this fixture family, so
  // the lens falls back to its existing "Set a start date" state rather than
  // rendering a grid of empty-day copy.
  it("renders no grid, and no empty-day copy, for a trip with no days", () => {
    renderLens(tripDetailFixture({ days: [], activities: {} }));
    expect(screen.queryByRole("grid", { name: "Trip calendar" })).toBeNull();
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  // A dated trip whose day list is empty: every cell the grid draws is
  // out-of-trip padding, so nothing claims to be an unplanned day.
  it("renders a dated trip with no days as all out-of-trip cells", () => {
    renderLens(tripDetailFixture({ startDate: "2027-06-01", days: [], activities: {} }));
    const cells = screen.queryAllByTestId("calendar-cell");
    expect(cells.every((cell) => cell.getAttribute("data-in-trip") === "false")).toBe(true);
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  // A day with many stops still shows one stop plus the overflow count, and
  // never the empty-day copy.
  it("renders a day holding many stops as first stop plus +N more", () => {
    const ids = Array.from({ length: 9 }, (_, i) => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`);
    renderLens(
      tripDetailFixture({
        startDate: "2027-06-01",
        days: [{ dayId: day1, activityIds: ids, date: "2027-06-01", costSubtotal: 0 }],
        activities: Object.fromEntries(
          ids.map((id, i) => [
            id,
            { activityId: id, title: `Stop ${i + 1}`, timeWindow: null, location: { name: "Rome" }, notes: null, anchors: [], cost: null },
          ]),
        ),
      }),
    );
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    expect(cell.textContent).toContain("Stop 1");
    expect(cell.textContent).toContain("+8 more");
    expect(cell.textContent).not.toContain("Nothing planned yet");
  });

  it("does not show +N more when there is only one activity", () => {
    const detail = tripDetailFixture({
      startDate: "2027-06-01",
      days: [{ dayId: day1, activityIds: [rome], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        [rome]: {
          activityId: rome,
          title: "Colosseum tour",
          timeWindow: null,
          location: { name: "Rome" },
          notes: null,
          anchors: [],
          cost: null,
        },
      },
    });
    renderLens(detail);
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    expect(cell.textContent).not.toContain("more");
  });
});
