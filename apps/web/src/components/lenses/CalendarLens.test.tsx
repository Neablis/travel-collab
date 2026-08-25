import { cleanup, render, screen, within } from "@testing-library/react";
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

const JUNE_GRID_LABEL = "Trip calendar, June 2027";

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

// A trip whose days hold no stops at all. `calendarMonths` pads the grid out
// to whole weeks, so this fixture also supplies the out-of-trip cells the
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
        timeWindow: { start: "09:00", end: "11:00" },
        location: { name: "Rome" },
        notes: null,
        anchors: [],
        cost: null,
      },
      [forum]: {
        activityId: forum,
        title: "Roman Forum",
        timeWindow: { start: "11:30", end: "13:00" },
        location: { name: "Rome" },
        notes: null,
        anchors: [],
        cost: null,
      },
      [flight]: {
        activityId: flight,
        title: "Flight home",
        timeWindow: { start: "17:00", end: "17:30" },
        location: null,
        notes: null,
        anchors: [],
        cost: null,
      },
    },
  });
}

describe("CalendarLens", () => {
  it("renders the 7-column weekday header, Sunday first", () => {
    renderLens(detailFixture());
    const grid = screen.getByRole("grid", { name: JUNE_GRID_LABEL });
    // The header is the grid's first 7 children, in order — asserting each
    // label merely exists would also pass for a Monday-first grid.
    const headerLabels = Array.from(grid.children)
      .slice(0, 7)
      .map((el) => el.textContent);
    expect(headerLabels).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  });

  it("renders the month header and the days-held note", () => {
    renderLens(detailFixture());
    expect(screen.getByText("June 2027")).toBeDefined();
    // "Day 1" appears twice: the note beside the month header, and the cell's
    // own "Day N" label — both are asserted elsewhere, so just confirm the
    // note's copy exists at all.
    expect(screen.getAllByText("Day 1").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the empty state and no grid when the trip has no start date", () => {
    renderLens(tripDetailFixture());
    expect(screen.getByText("Set a start date to see the calendar.")).toBeDefined();
    expect(screen.queryByRole("grid")).toBeNull();
  });

  // dc.html:3053's per-day summary line sits BELOW up to three stop chips
  // (dc.html:663-696) — it does not replace them (that was 8b.5's gap).
  it("shows Day N, city, and the stop-count/time-range summary on an in-trip cell", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    expect(cell.textContent).toContain("Day 1");
    expect(cell.textContent).toContain("Rome");
    expect(cell.textContent).toContain("3 stops");
    // Colosseum starts 09:00, flight home ends 17:30 — earliest start to latest end.
    expect(cell.textContent).toContain("9 am – 5:30 pm");
  });

  // dc.html:685-691: up to three chips (`c.chips`, `slice(0, 3)`), each
  // time (font-mono) then name, inside the in-trip inner card.
  it("renders up to three stop chips with time and name", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    const chips = within(cell).getAllByTestId("calendar-chip");
    expect(chips).toHaveLength(3);
    expect(chips[0]!.textContent).toContain("9 am");
    expect(chips[0]!.textContent).toContain("Colosseum tour");
    expect(chips[1]!.textContent).toContain("11:30 am");
    expect(chips[1]!.textContent).toContain("Roman Forum");
    expect(chips[2]!.textContent).toContain("5 pm");
    expect(chips[2]!.textContent).toContain("Flight home");
  });

  // dc.html:686's `slice(0, 3)` — a fourth stop is real (it counts toward
  // the "N stops" summary) but is not itself a chip.
  it("does not render a fourth stop as a chip", () => {
    const ids = Array.from({ length: 4 }, (_, i) => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`);
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
    const chips = within(cell).getAllByTestId("calendar-chip");
    expect(chips).toHaveLength(3);
    expect(cell.textContent).toContain("4 stops");
    expect(cell.textContent).not.toContain("Stop 4");
  });

  // A shorter window nested entirely inside a longer one sorts *after* it by
  // start (10:00 > 09:00), so "take the last-sorted end" would report 11 am
  // and hide that the day actually runs to 5 pm.
  it("reports the enclosing window's end, not a shorter window nested inside it", () => {
    const detail = tripDetailFixture({
      startDate: "2027-06-01",
      days: [{ dayId: day1, activityIds: [rome, forum], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        [rome]: {
          activityId: rome,
          title: "All-day pass",
          timeWindow: { start: "09:00", end: "17:00" },
          location: { name: "Rome" },
          notes: null,
          anchors: [],
          cost: null,
        },
        [forum]: {
          activityId: forum,
          title: "Guided tour",
          timeWindow: { start: "10:00", end: "11:00" },
          location: { name: "Rome" },
          notes: null,
          anchors: [],
          cost: null,
        },
      },
    });
    renderLens(detail);
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    expect(cell.textContent).toContain("9 am – 5 pm");
    expect(cell.textContent).not.toContain("11 am");
  });

  it("omits the time range when none of the day's stops are timed", () => {
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
    expect(cell.textContent).toContain("1 stop");
    expect(cell.textContent).not.toContain("1 stops");
    expect(cell.textContent).not.toContain("·");
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
    expect(screen.queryByRole("grid")).toBeNull();
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  // A dated trip whose day list is empty falls back to the same "Set a start
  // date" state as an undated trip — there is no month to derive a block
  // from, so nothing is rendered rather than an all-padding grid.
  it("renders the empty state, not a grid, for a dated trip with no days", () => {
    renderLens(tripDetailFixture({ startDate: "2027-06-01", days: [], activities: {} }));
    expect(screen.getByText("Set a start date to see the calendar.")).toBeDefined();
    expect(screen.queryAllByTestId("calendar-cell")).toHaveLength(0);
    expect(screen.queryByText("Nothing planned yet")).toBeNull();
  });

  it("renders a day holding many stops as a stop count, never the empty-day copy", () => {
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
    expect(cell.textContent).toContain("9 stops");
    // Only the first three become chips (dc.html:686's slice(0, 3)) — the
    // rest are counted in the summary but not individually named.
    expect(within(cell).getAllByTestId("calendar-chip")).toHaveLength(3);
    expect(cell.textContent).not.toContain("Stop 4");
    expect(cell.textContent).not.toContain("Nothing planned yet");
  });

  // Phase 8 Task 8.6: the tint belongs to the button inside the cell, not the
  // cell itself — the cell is a plain bg-surface wrapper at least 116px tall.
  // dc.html:679: the tint belongs to the inner day card (data-calday), not
  // the surface cell around it — restated for the rebuilt markup, where the
  // whole cell is the clickable button and the tint moved to a child div.
  it("puts the day tint on the inner card, not the cell button", () => {
    renderLens(detailFixture());
    const button = screen.getByRole("button", { name: /Day 1, Rome/ });
    expect(button.className).toMatch(/bg-surface/);
    expect(button.className).not.toMatch(/-tint\b/);
    const card = within(button).getByTestId("calendar-day-card");
    expect(card.className).toMatch(/bg-\w+-tint/);
  });

  // dc.html:663-696: the city name lives in the tinted card's header row,
  // beside the grip — not loose text in the cell.
  it("shows the city in the day card header", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    const card = within(cell).getByTestId("calendar-day-card");
    expect(card.textContent).toContain("Rome");
  });

  // dc.html:668-670: "Day N" sits on the cell's top row, right of the date
  // number, only when `c.inTrip`.
  it("renders Day N on the right for in-trip days only, never for out-of-trip days", () => {
    renderLens(detailWithEmptyDay());
    expect(screen.getByRole("button", { name: /Day 1/ })).toBeDefined();
    const outOfTrip = screen
      .getAllByTestId("calendar-cell")
      .filter((cell) => cell.getAttribute("data-in-trip") === "false");
    expect(outOfTrip.length).toBeGreaterThan(0);
    for (const cell of outOfTrip) {
      expect(cell.textContent).not.toMatch(/Day \d/);
    }
  });

  // dc.html:678's `sc-if value="c.inTrip"` — an out-of-trip cell renders no
  // inner card at all (no tint, no grip, no chips), just the bare date.
  it("renders no inner card on an out-of-trip cell", () => {
    renderLens(detailWithEmptyDay());
    const outOfTrip = screen
      .getAllByTestId("calendar-cell")
      .filter((cell) => cell.getAttribute("data-in-trip") === "false");
    expect(outOfTrip.length).toBeGreaterThan(0);
    for (const cell of outOfTrip) {
      expect(within(cell).queryByTestId("calendar-day-card")).toBeNull();
    }
  });

  // A trip that crosses a month boundary renders one grid per month, each
  // with its own header — the component-level counterpart to
  // calendarData.test.ts's pure `calendarMonths` coverage.
  it("renders one grid per month for a trip crossing a month boundary", () => {
    const days = Array.from({ length: 10 }, (_, i) => {
      const dt = new Date(Date.UTC(2022, 10, 27 + i));
      return {
        dayId: `88888888-8888-4888-8888-${String(i).padStart(12, "0")}`,
        activityIds: [],
        date: dt.toISOString().slice(0, 10),
        costSubtotal: 0,
      };
    });
    renderLens(tripDetailFixture({ startDate: "2022-11-27", days, activities: {} }));
    expect(screen.getByRole("grid", { name: "Trip calendar, November 2022" })).toBeDefined();
    expect(screen.getByRole("grid", { name: "Trip calendar, December 2022" })).toBeDefined();
    expect(screen.getByText("November 2022")).toBeDefined();
    expect(screen.getByText("December 2022")).toBeDefined();
  });
});
