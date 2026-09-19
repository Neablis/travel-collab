import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchTripsMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchTrips: (...a: unknown[]) => fetchTripsMock(...a),
  createTrip: vi.fn(),
  insertSavedDay: vi.fn(),
  sendTripCommandBatch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

import { AddToTripDialog } from "./AddToTripDialog";

// **M23 link 4's one substantive rule, as a test:** *a surface states the count
// it is acting on before it acts.* This dialog is the surface that performs the
// append, so it is the sharpest instance — "add to trip" quietly appending
// three days when somebody expected one is the failure the rule exists to stop.
//
// It exists because a preview walk caught this dialog still saying "this day is
// day 1" over a three-day Playbook, two lines above a sentence in the same
// dialog reading "All 3 days are appended". The fix was three strings; one of
// them silently failed to apply and only a SECOND walk caught it. A test is
// cheaper than a third walk, and it is the thing that would have caught it.

const TRIP_ID = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

beforeEach(() => {
  fetchTripsMock.mockReset().mockResolvedValue({
    ok: true,
    value: [
      {
        tripId: TRIP_ID,
        name: "Japan",
        status: "active",
        members: [{ userId: "u", role: "owner", name: null, email: null }],
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  });
});
afterEach(cleanup);

function renderDialog(dayCount: number) {
  render(
    <AddToTripDialog
      open
      onOpenChange={vi.fn()}
      savedDayId="aa000000-0000-4000-8000-000000000001"
      dayName="Three in Kansai"
      dayCount={dayCount}
      onConflict={vi.fn()}
    />,
  );
}

describe("a multi-day Playbook", () => {
  it("names the count in the title", async () => {
    renderDialog(3);
    expect(await screen.findByText(/Add “Three in Kansai” \(3 days\) to a trip/)).toBeTruthy();
  });

  it("says how many days it will append, in the plural", async () => {
    renderDialog(3);
    expect(
      await screen.findByText(/All 3 days are appended at the end, in order/),
    ).toBeTruthy();
  });

  // The start-date hint is where somebody reasons about how much of their
  // calendar the new trip occupies, so a singular claim here is the worst
  // placed of the three. This is the exact string that silently failed to
  // change.
  it("tells a NEW trip which days it will occupy, not 'this day is day 1'", async () => {
    renderDialog(3);
    await userEvent.selectOptions(await screen.findByLabelText("Which trip"), "new");
    expect(await screen.findByLabelText("Start date")).toBeTruthy();
    expect(screen.getByText(/its 3 days become days 1–3/)).toBeTruthy();
    expect(screen.queryByText(/this day is day 1/)).toBeNull();
  });
});

describe("a one-day Playbook", () => {
  // The ordinary case, and it must read exactly as it always did — a plural
  // that says "All 1 days are appended" would be its own defect.
  it("stays singular in the title, the body and the start-date hint", async () => {
    renderDialog(1);
    expect(await screen.findByText(/Add “Three in Kansai” to a trip/)).toBeTruthy();
    expect(screen.getByText(/The day is appended at the end, keeping its order and gaps/)).toBeTruthy();
    expect(screen.queryByText(/\(1 days\)/)).toBeNull();
  });
});
