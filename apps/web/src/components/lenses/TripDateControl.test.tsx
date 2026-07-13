import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripCommand } from "@tc/contracts";
import { TripDateControl } from "./TripDateControl";

const TRIP_ID = "7d9a1f8e-0000-4000-8000-00000000000a";

afterEach(cleanup);

describe("TripDateControl", () => {
  it("setting a date dispatches SetTripStartDate with the new value", () => {
    const onCommand = vi.fn<(command: TripCommand) => void>();
    render(<TripDateControl tripId={TRIP_ID} startDate={null} onCommand={onCommand} />);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-10-12" } });
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripStartDate", tripId: TRIP_ID, startDate: "2026-10-12" });
  });

  it("Clear date (in the date-options popover) dispatches SetTripStartDate with startDate: null", () => {
    const onCommand = vi.fn<(command: TripCommand) => void>();
    render(<TripDateControl tripId={TRIP_ID} startDate="2026-10-12" onCommand={onCommand} />);
    // Clearing is a rare op, so it's tucked behind a small popover trigger
    // rather than a standalone button (#2) — open it before clicking clear.
    fireEvent.click(screen.getByRole("button", { name: /date options/i }));
    fireEvent.click(screen.getByRole("button", { name: /clear date/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripStartDate", tripId: TRIP_ID, startDate: null });
  });
});
