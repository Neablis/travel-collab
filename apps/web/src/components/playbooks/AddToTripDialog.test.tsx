import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tripDetailFixture } from "@tc/factories";

const fetchTripsMock = vi.fn();
const fetchTripDetailMock = vi.fn();
const insertSavedDayMock = vi.fn();
const pushMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchTrips: (...a: unknown[]) => fetchTripsMock(...a),
  fetchTripDetail: (...a: unknown[]) => fetchTripDetailMock(...a),
  createTrip: vi.fn(),
  insertSavedDay: (...a: unknown[]) => insertSavedDayMock(...a),
  sendTripCommandBatch: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock }) }));

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
const SAVED_DAY_ID = "aa000000-0000-4000-8000-000000000001";
// The trip's five days, in order: Day 4 is DAY_IDS[3].
const DAY_IDS = [1, 2, 3, 4, 5].map((n) => `bb000000-0000-4000-8000-00000000000${n}`);

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
  fetchTripDetailMock.mockReset().mockResolvedValue({
    ok: true,
    value: tripDetailFixture({
      tripId: TRIP_ID,
      days: DAY_IDS.map((dayId) => ({ dayId, activityIds: [], date: null, costSubtotal: 0 })),
    }),
  });
  insertSavedDayMock.mockReset().mockResolvedValue({ ok: true, value: {} });
  pushMock.mockReset();
});
afterEach(cleanup);

function dialog(dayCount: number, open = true) {
  return (
    <AddToTripDialog
      open={open}
      onOpenChange={vi.fn()}
      savedDayId={SAVED_DAY_ID}
      dayName="Three in Kansai"
      dayCount={dayCount}
      onConflict={vi.fn()}
    />
  );
}

function renderDialog(dayCount: number) {
  return render(dialog(dayCount));
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
  it("stays singular in the title and the body", async () => {
    renderDialog(1);
    expect(await screen.findByText(/Add “Three in Kansai” to a trip/)).toBeTruthy();
    expect(screen.getByText(/The day is appended at the end, keeping its order and gaps/)).toBeTruthy();
    expect(screen.queryByText(/\(1 days\)/)).toBeNull();
  });

  // **The start-date hint is only rendered once "Start a new trip" is picked**,
  // so the test above never reached it — it asserted the absence of a plural
  // marker on a string that was not on screen. CodeRabbit caught that on
  // PR #192, and it is the same class of hole as the silent no-op: an assertion
  // that cannot fail is not coverage.
  it("tells a NEW trip that this day is day 1, in the singular", async () => {
    renderDialog(1);
    await userEvent.selectOptions(await screen.findByLabelText("Which trip"), "new");
    expect(await screen.findByLabelText("Start date")).toBeTruthy();
    expect(screen.getByText(/and this day is day 1\./)).toBeTruthy();
    expect(screen.queryByText(/days become days/)).toBeNull();
  });
});

// M51 decision 8c: a borrowed day lands on a CHOSEN existing day, through the
// server's `startingAt` merge (ADR-050), and the default is still the append.
describe("which day of the trip", () => {
  it("posts the chosen day's id as startingAt", async () => {
    renderDialog(1);
    const which = await screen.findByLabelText("Which day");
    await screen.findByRole("option", { name: "Day 4" });
    await userEvent.selectOptions(which, "Day 4");
    await userEvent.click(screen.getByRole("button", { name: "Add to trip" }));
    expect(insertSavedDayMock).toHaveBeenCalledWith(TRIP_ID, SAVED_DAY_ID, { startingAt: DAY_IDS[3] });
    expect(pushMock).toHaveBeenCalledWith(`/trips/${TRIP_ID}`);
  });

  it("appends after the last day when no day is chosen", async () => {
    renderDialog(1);
    await screen.findByRole("option", { name: "Day 4" });
    expect(screen.getByLabelText("Which day")).toHaveProperty("value", "");
    await userEvent.click(screen.getByRole("button", { name: "Add to trip" }));
    expect(insertSavedDayMock).toHaveBeenCalledWith(TRIP_ID, SAVED_DAY_ID, {});
  });
});

const OTHER_TRIP_ID = "7f0b3d0f-4a8b-4c7f-8e4a-3c2b6d9e8f70";

describe("a trip whose days cannot be read", () => {
  // The failure belongs to the trip it was read for: a reader who moves to a
  // trip whose days did load must not see it beside a working list.
  it("says so on that trip, and not on the next one", async () => {
    fetchTripsMock.mockResolvedValue({
      ok: true,
      value: [TRIP_ID, OTHER_TRIP_ID].map((tripId, i) => ({
        tripId,
        name: i === 0 ? "Japan" : "Peru",
        status: "active",
        members: [{ userId: "u", role: "owner", name: null, email: null }],
        createdAt: "2026-01-01T00:00:00.000Z",
      })),
    });
    const peru = fetchTripDetailMock.getMockImplementation();
    fetchTripDetailMock.mockImplementation((tripId: string) =>
      tripId === TRIP_ID ? Promise.resolve({ ok: false, error: { status: 500, message: "boom" } }) : peru?.(tripId),
    );
    renderDialog(1);
    await waitFor(() => expect(screen.getByLabelText("Which day")).toHaveProperty("disabled", false));

    await userEvent.selectOptions(screen.getByLabelText("Which trip"), "Peru");
    await screen.findByRole("option", { name: "Day 4" });
    expect(screen.queryByText(/boom|could not be read/)).toBeNull();

    await userEvent.selectOptions(screen.getByLabelText("Which trip"), "Japan");
    expect(await screen.findByText(/This trip's days could not be read/)).toBeTruthy();
  });
});

// The dialog stays mounted between openings, so whatever it read last time is
// still in its state when it opens again.
describe("opening the dialog again", () => {
  async function openCloseReopen() {
    const view = renderDialog(1);
    await screen.findByRole("option", { name: "Day 4" });
    view.rerender(dialog(1, false));
    return view;
  }

  it("does not offer the days the last opening read", async () => {
    const view = await openCloseReopen();
    fetchTripDetailMock.mockReturnValue(new Promise(() => {}));
    view.rerender(dialog(1));
    expect(await screen.findByLabelText("Which day")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("option", { name: "Day 4" })).toBeNull();
  });

  // The trip is kept from the last opening, so its days can arrive before the
  // trip list does; a day picked in that window is still the one added.
  it("keeps a day picked before the trip list arrives", async () => {
    const view = await openCloseReopen();
    let release: () => void = () => {};
    const trips = await fetchTripsMock();
    fetchTripsMock.mockReturnValue(new Promise((resolve) => (release = () => resolve(trips))));
    view.rerender(dialog(1));
    await screen.findByRole("option", { name: "Day 4" });
    await userEvent.selectOptions(screen.getByLabelText("Which day"), "Day 4");

    await act(async () => release());
    expect(screen.getByLabelText("Which day")).toHaveProperty("value", DAY_IDS[3]);
    await userEvent.click(screen.getByRole("button", { name: "Add to trip" }));
    expect(insertSavedDayMock).toHaveBeenCalledWith(TRIP_ID, SAVED_DAY_ID, { startingAt: DAY_IDS[3] });
  });
});
