import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TripDetail, PageContext } from "@tc/contracts";
import { MacroView } from "./MacroView";

afterEach(cleanup);

const baseDetail: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Test Trip",
  startDate: null,
  currency: "USD",
  budget: null,
  members: [{ userId: "u1", role: "owner" }],
  forkedFrom: null,
  days: [{ dayId: "22222222-2222-2222-2222-222222222222", activityIds: [], date: null, costSubtotal: 0 }],
  backlog: [],
  activities: {},
  conflicts: [],
  dismissedConflictIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  unscheduledCostSubtotal: 0,
  tripCostTotal: 12345,
  budgetRemaining: null,
  status: "active",
};

const ctx: PageContext = { tripId: baseDetail.tripId };

describe("MacroView", () => {
  it("shows the formatted total for cost.trip when there is a total", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost.trip" params={{}} />);
    expect(screen.getByText("$123.45")).toBeTruthy();
  });

  it("shows the 'no costs yet' chip for cost.trip when the total is zero", () => {
    const zeroDetail: TripDetail = { ...baseDetail, tripCostTotal: 0 };
    render(<MacroView detail={zeroDetail} context={ctx} name="cost.trip" params={{}} />);
    expect(screen.getByText("no costs yet")).toBeTruthy();
  });

  // These two are one assertion split in half: an unbound widget offers an
  // action when there IS one, and says so inertly when there is not. The single
  // test they replace asserted only the chip's text while calling it
  // "actionable", so it passed just as happily once `PageScreen` stopped
  // passing `onBindDay` and the chip became a button that did nothing.
  it("offers an actionable 'select a day' chip for cost.day when rebinding is possible", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost.day" params={{}} onBindDay={() => {}} />);
    expect(screen.getByRole("button", { name: "select a day" })).toBeTruthy();
  });

  it("states 'no day set' without offering a control when nothing can rebind", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost.day" params={{}} />);
    expect(screen.getByText("no day set")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
