import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedDay } from "@tc/contracts";

const fetchSavedDaysMock = vi.fn();
const insertSavedDayMock = vi.fn();
const deleteSavedDayMock = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  fetchSavedDays: (...args: unknown[]) => fetchSavedDaysMock(...args),
  insertSavedDay: (...args: unknown[]) => insertSavedDayMock(...args),
  deleteSavedDay: (...args: unknown[]) => deleteSavedDayMock(...args),
}));

import { SavedDaysDialog } from "./SavedDaysDialog";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";

const saved: SavedDay = {
  savedDayId: "3c5e7f90-2222-4333-8444-555566667777",
  ownerId: "dev-alice",
  name: "A day in Nakameguro",
  stops: [
    {
      title: "Coffee",
      timeWindow: { start: "09:00", end: "10:00" },
      location: null,
      notes: null,
      anchors: [],
      kind: "planned",
      tags: [],
      cost: null,
    },
    {
      title: "Dinner",
      timeWindow: { start: "19:00", end: "21:00" },
      location: null,
      notes: null,
      anchors: [],
      kind: "planned",
      tags: [],
      cost: null,
    },
  ],
  sourceTripId: "11111111-1111-4111-8111-111111111111",
  sourceTripName: "Kyoto",
  createdAt: "2026-08-01T00:00:00.000Z",
};

function renderDialog() {
  const onOpenChange = vi.fn();
  const onInserted = vi.fn();
  render(
    <SavedDaysDialog open onOpenChange={onOpenChange} tripId={tripId} onInserted={onInserted} />,
  );
  return { onOpenChange, onInserted };
}

afterEach(cleanup);
beforeEach(() => {
  fetchSavedDaysMock.mockReset().mockResolvedValue({ ok: true, value: [saved] });
  insertSavedDayMock.mockReset().mockResolvedValue({
    ok: true,
    value: { detail: { tripId }, history: { tripId } },
  });
  deleteSavedDayMock.mockReset().mockResolvedValue({ ok: true, value: { ok: true } });
});

describe("SavedDaysDialog", () => {
  it("lists each saved day with what is in it and where it came from", async () => {
    renderDialog();
    expect(await screen.findByText("A day in Nakameguro")).toBeTruthy();
    expect(screen.getByText("2 stops · 9 am–9 pm")).toBeTruthy();
    expect(screen.getByText("From Kyoto")).toBeTruthy();
  });

  it("says what to do when the library is empty", async () => {
    fetchSavedDaysMock.mockResolvedValue({ ok: true, value: [] });
    renderDialog();
    expect(await screen.findByText(/Use the pennant on a day in Timeline/)).toBeTruthy();
  });

  it("inserts into this trip and hands the outcome back", async () => {
    const { onOpenChange, onInserted } = renderDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Add to trip" }));
    await waitFor(() => expect(insertSavedDayMock).toHaveBeenCalledWith(tripId, saved.savedDayId));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onInserted).toHaveBeenCalledWith({ detail: { tripId }, history: { tripId } });
  });

  it("forgets a saved day and re-reads the library", async () => {
    renderDialog();
    await userEvent.click(
      await screen.findByRole("button", { name: `Forget ${saved.name}` }),
    );
    await waitFor(() => expect(deleteSavedDayMock).toHaveBeenCalledWith(saved.savedDayId));
    expect(fetchSavedDaysMock).toHaveBeenCalledTimes(2);
  });

  it("reports a refused insert rather than closing as if it worked", async () => {
    insertSavedDayMock.mockResolvedValue({ ok: false, error: { status: 403, message: "forbidden" } });
    const { onOpenChange } = renderDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Add to trip" }));
    expect(await screen.findByText("forbidden")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

// The same defect TravelersPanel and ShareButton were fixed for in an earlier
// round. Link 6 was not part of PR #70, so this dialog never got it: the
// dialog is reopened rather than remounted, so a failed load left its message
// sitting above the fresh list (CodeRabbit, PR #71).
describe("SavedDaysDialog error handling", () => {
  it("clears a failed load's message once a later load succeeds", async () => {
    fetchSavedDaysMock.mockReset().mockResolvedValueOnce({
      ok: false,
      error: { status: 500, message: "Could not load your saved days." },
    });
    const { rerender } = render(
      <SavedDaysDialog open onOpenChange={vi.fn()} tripId={tripId} onInserted={vi.fn()} />,
    );
    expect(await screen.findByText("Could not load your saved days.")).toBeTruthy();

    // Reopening runs `load` again — this time it works. `rerender` on the SAME
    // instance, not cleanup + a fresh render: a new instance initialises
    // `error` to null, so the assertion below would have passed whether or not
    // `load` clears it. My own vacuous witness, caught by CodeRabbit on #71 —
    // the very defect class this test exists to guard.
    fetchSavedDaysMock.mockResolvedValue({ ok: true, value: [saved] });
    rerender(
      <SavedDaysDialog open={false} onOpenChange={vi.fn()} tripId={tripId} onInserted={vi.fn()} />,
    );
    rerender(
      <SavedDaysDialog open onOpenChange={vi.fn()} tripId={tripId} onInserted={vi.fn()} />,
    );

    expect(await screen.findByText("A day in Nakameguro")).toBeTruthy();
    await waitFor(() =>
      expect(screen.queryByText("Could not load your saved days.")).toBeNull(),
    );
  });
});
