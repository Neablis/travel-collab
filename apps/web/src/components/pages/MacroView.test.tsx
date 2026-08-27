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

  it("shows a 'select a day' actionable chip for cost.day with no day binding", () => {
    render(<MacroView detail={baseDetail} context={ctx} name="cost.day" params={{}} />);
    expect(screen.getByText("select a day")).toBeTruthy();
  });
});
