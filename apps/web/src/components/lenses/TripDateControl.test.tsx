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

  it("Clear dates dispatches SetTripStartDate with startDate: null", () => {
    const onCommand = vi.fn<(command: TripCommand) => void>();
    render(<TripDateControl tripId={TRIP_ID} startDate="2026-10-12" onCommand={onCommand} />);
    fireEvent.click(screen.getByRole("button", { name: /clear dates/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripStartDate", tripId: TRIP_ID, startDate: null });
  });
});
