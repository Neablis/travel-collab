import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripRole } from "@tc/contracts";

const useTripMock = vi.fn();
vi.mock("@/components/trip/context/TripProvider", () => ({
  useTrip: () => useTripMock(),
}));

const savedDaysDialogSpy = vi.fn();
vi.mock("@/components/trip/SavedDaysDialog", () => ({
  SavedDaysDialog: (props: { open: boolean; tripId: string }) => {
    savedDaysDialogSpy(props);
    return props.open ? <div data-testid="saved-days-dialog">{props.tripId}</div> : null;
  },
}));

import { AddSavedDayButton } from "./AddSavedDayButton";

const tripId = "6e9a2c9e-3f7a-4b6e-9d3f-2b1a5c8d7e6f";
const applyOutcome = vi.fn();

function asRole(myRole: TripRole, pending = false) {
  useTripMock.mockReturnValue({ tripId, applyOutcome, readOnly: myRole === "viewer", pending });
}

afterEach(cleanup);
beforeEach(() => {
  useTripMock.mockReset();
  savedDaysDialogSpy.mockReset();
  applyOutcome.mockReset();
  asRole("owner");
});

// Real as of M11 link 6. It was <Preview id="add-saved-day"> — an inert button
// in a file the app did not even render, parked in preview-registry.test.ts's
// PARKED escape hatch since M10 Wave 2 (KI-31).
describe("AddSavedDayButton", () => {
  it("opens the saved-days picker for this trip", async () => {
    render(<AddSavedDayButton />);
    await userEvent.click(screen.getByRole("button", { name: "Add a saved day" }));
    expect((await screen.findByTestId("saved-days-dialog")).textContent).toBe(tripId);
  });

  // The server refuses the insert for a viewer (`editor` on the route); a
  // button that always fails is worse than no button.
  it("is not offered on a read-only trip", () => {
    asRole("viewer");
    render(<AddSavedDayButton />);
    expect(screen.queryByRole("button", { name: "Add a saved day" })).toBeNull();
  });

  // The insert IS a command batch and returns the authoritative detail and
  // history, so the board reconciles from the response with no refetch — the
  // same path the AI planning batch and undo/redo already take.
  it("hands the insert's outcome straight to the board", async () => {
    render(<AddSavedDayButton />);
    await userEvent.click(screen.getByRole("button", { name: "Add a saved day" }));
    expect(savedDaysDialogSpy).toHaveBeenCalledWith(
      expect.objectContaining({ onInserted: applyOutcome }),
    );
  });
});

// docs/reviews/2026-08-28-m11-pr71-review.md §4. The insert comes back as an
// authoritative outcome and `applyOutcome` clears `pending` to take it — so
// inserting on top of a queued-but-unsent drag discarded that drag from the
// UI and the server both, silently, and wiped a KI-36-retained failure queue
// without ever offering its retry.
describe("AddSavedDayButton — unsent work blocks the insert", () => {
  it("disables the button, with a reason, while the queue holds unsent edits", async () => {
    asRole("owner", true);
    render(<AddSavedDayButton />);

    const button = screen.getByRole("button", { name: "Add a saved day" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.getAttribute("title")).toBe("Saving your changes — available in a moment");

    // Not merely styled as unavailable: the picker cannot be reached, so the
    // insert that would clear `pending` can never be started.
    await userEvent.click(button);
    expect(screen.queryByTestId("saved-days-dialog")).toBeNull();
  });

  it("is enabled again once nothing is unsent", () => {
    asRole("owner", false);
    render(<AddSavedDayButton />);
    const button = screen.getByRole("button", { name: "Add a saved day" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("title")).toBeNull();
  });
});
