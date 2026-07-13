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

  it("the Clear date X clears the start date directly (#19)", () => {
    const onCommand = vi.fn<(command: TripCommand) => void>();
    render(<TripDateControl tripId={TRIP_ID} startDate="2026-10-12" onCommand={onCommand} />);
    // #19: a one-item "Date options" popover was silly for a single action —
    // clearing is now a direct X next to the date, no menu to open first.
    fireEvent.click(screen.getByRole("button", { name: /clear date/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripStartDate", tripId: TRIP_ID, startDate: null });
  });

  it("hides the Clear date X when there is no date to clear", () => {
    const onCommand = vi.fn<(command: TripCommand) => void>();
    render(<TripDateControl tripId={TRIP_ID} startDate={null} onCommand={onCommand} />);
    expect(screen.queryByRole("button", { name: /clear date/i })).toBeNull();
  });
});
