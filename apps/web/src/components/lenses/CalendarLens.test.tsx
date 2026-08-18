import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { tripDetailFixture } from "@/mocks/fixtures";
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
