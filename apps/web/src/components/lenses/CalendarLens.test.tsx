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
        location: { name: "Rome", city: "Rome" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      [forum]: {
        activityId: forum,
        title: "Roman Forum",
        timeWindow: { start: "11:30", end: "13:00" },
        location: { name: "Rome", city: "Rome" },
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
        cost: null,
      },
      [flight]: {
        activityId: flight,
        title: "Flight home",
        timeWindow: { start: "17:00", end: "17:30" },
        location: null,
        notes: null,
        anchors: [],
        kind: "planned" as const,
        tags: [],
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
    // TWO, not three: this day's third stop is the unlocated flight home, and
    // Rome's card counts Rome's stops. It said "3 stops" while grouping folded
    // city-less stops into whatever city was in progress — which was a guess
    // about where the flight was. The flight is still on the cell, in its own
    // untitled group; it just no longer counts as a Rome stop.
    expect(cell.textContent).toContain("2 stops");
    // Colosseum starts 09:00, and Rome's window ends with Rome — 13:00, not
    // the flight's 17:30.
    expect(cell.textContent).toContain("9 am – 1 pm");
  });

  // SPEC §12 replaced the per-stop chips with a per-city summary: "Calendar no
  // longer lists activities." These two tests used to assert the chips existed
  // and that a fourth stop was elided; both now assert the opposite, because
  // naming individual stops here is the thing the redesign removed.
  it("names no individual stop — the cell summarises, it does not list", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });

    expect(within(cell).queryAllByTestId("calendar-chip")).toHaveLength(0);
    expect(cell.textContent).not.toContain("Colosseum tour");
    expect(cell.textContent).not.toContain("Roman Forum");
    expect(cell.textContent).not.toContain("Flight home");
    // What replaces them: the city, its stop count, and its window.
    expect(cell.textContent).toContain("Rome");
    expect(cell.textContent).toContain("2 stops");
  });

  it("counts every stop in the summary, however many there are", () => {
    // The old cell showed three chips and silently dropped the rest; a count
    // has no such ceiling, which is half the point of the change.
    const ids = Array.from({ length: 9 }, (_, i) => `77777777-7777-4777-8777-${String(i).padStart(12, "0")}`);
    renderLens(
      tripDetailFixture({
        startDate: "2027-06-01",
        days: [{ dayId: day1, activityIds: ids, date: "2027-06-01", costSubtotal: 0 }],
        activities: Object.fromEntries(
          ids.map((id, i) => [
            id,
            { activityId: id, title: `Stop ${i + 1}`, timeWindow: null, location: { name: "Rome", city: "Rome" }, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
          ]),
        ),
      }),
    );
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });

    expect(cell.textContent).toContain("9 stops");
    expect(cell.textContent).not.toContain("Stop 1");
    expect(cell.textContent).not.toContain("Nothing planned yet");
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
          location: { name: "Rome", city: "Rome" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
        [forum]: {
          activityId: forum,
          title: "Guided tour",
          timeWindow: { start: "10:00", end: "11:00" },
          location: { name: "Rome", city: "Rome" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
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
          location: { name: "Rome", city: "Rome" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
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
  //
  // CodeRabbit (PR #46 final review): the cell's `aria-label` already bakes
  // in "Day 1, Rome" regardless of what actually renders, and the old
  // `card.textContent` check searched the whole card, so this couldn't fail
  // even if the header row were deleted (aria-label unaffected) or "Rome"
  // only survived somewhere else in the card. Scoped to the header element
  // itself, found by test id rather than by the accessible name that isn't
  // wired to the visible markup either.
  it("shows the city in the day card header", () => {
    renderLens(detailFixture());
    const cell = screen.getByRole("button", { name: /Day 1, Rome/ });
    const card = within(cell).getByTestId("calendar-day-card");
    const header = within(card).getByTestId("calendar-day-header");
    expect(header.textContent).toContain("Rome");
  });

  // dc.html:668-670: "Day N" sits on the cell's top row, right of the date
  // number, only when `c.inTrip`.
  //
  // CodeRabbit (PR #46 final review): `getByRole("button", { name: /Day 1/ })`
  // matches the button's `aria-label`, which is set unconditionally and
  // independently of whatever actually renders inside it — this assertion
  // could never fail even if the visible "Day N" span were deleted entirely.
  // Query the visible label element itself instead.
  it("renders Day N on the right for in-trip days only, never for out-of-trip days", () => {
    renderLens(detailWithEmptyDay());
    const day1Cell = screen.getByRole("button", { name: /^Day 1$/ });
    expect(within(day1Cell).getByTestId("calendar-day-label").textContent).toBe("Day 1");
    const outOfTrip = screen
      .getAllByTestId("calendar-cell")
      .filter((cell) => cell.getAttribute("data-in-trip") === "false");
    expect(outOfTrip.length).toBeGreaterThan(0);
    for (const cell of outOfTrip) {
      expect(within(cell).queryByTestId("calendar-day-label")).toBeNull();
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
