import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripCommand } from "@tc/contracts";
import { uuidFrom } from "@tc/factories";
import { TripDateControl } from "./TripDateControl";

const TRIP_ID = uuidFrom(1);

afterEach(cleanup);

// Task 8b.6's own Step 1 helper: TripDateControl's props are scalars, not a
// TripDetail, so there's no tripDetailFixture literal to build here (ADR-020
// governs projection fixtures) — this just keeps every call site's tripId
// consistent with the factories package's deterministic ids.
function renderDateControl(props: { startDate: string | null; endDate?: string | null; dayCount?: number }) {
  const onCommand = vi.fn<(command: TripCommand) => void>();
  render(<TripDateControl tripId={TRIP_ID} onCommand={onCommand} {...props} />);
  return { onCommand };
}

describe("TripDateControl", () => {
  it("has no end-date field", () => {
    renderDateControl({ startDate: "2026-10-03", dayCount: 14 });
    expect(screen.queryByLabelText("End date")).toBeNull();
  });

  it("shows the end derived from the plan's day count", () => {
    renderDateControl({ startDate: "2026-10-03", endDate: "2026-10-16", dayCount: 14 });
    expect(screen.getByText("→ Oct 16, 2026")).toBeTruthy();
  });

  it("says how the end follows the plan", () => {
    renderDateControl({ startDate: "2026-10-03", dayCount: 14 });
    expect(screen.getByText(/The end follows the 14 days in your plan/)).toBeTruthy();
  });

  // Mitchell testing the preview, 2026-08-24: "Selecting the date with the
  // date picker should automatically save, you shouldnt have to hit done."
  // Done is now a close affordance only (see below) — selection itself
  // commits, leaving day count untouched.
  it("commits the start alone as soon as a valid date is selected, with no Done click", () => {
    const { onCommand } = renderDateControl({ startDate: "2026-10-03", dayCount: 14 });
    fireEvent.change(screen.getByLabelText("Trip start date"), { target: { value: "2026-10-05" } });

    expect(onCommand).toHaveBeenCalledWith({
      type: "SetTripStartDate",
      tripId: TRIP_ID,
      startDate: "2026-10-05",
    });
  });

  // A native type="date" input's `value` is only ever a complete calendar
  // date or "" (the HTML5 sanitization algorithm withholds it while a
  // segment is unfilled) — but some browsers have been observed firing
  // `change` on a partial edit anyway. Guard against both: an empty value
  // (that's the dedicated Clear-date X's job, not this field) and a
  // malformed/partial one must never reach onCommand.
  it("dispatches nothing for an empty or incomplete date value", () => {
    const { onCommand } = renderDateControl({ startDate: "2026-10-03", dayCount: 14 });
    const input = screen.getByLabelText("Trip start date");

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.change(input, { target: { value: "2026-10" } });

    expect(onCommand).not.toHaveBeenCalled();
  });

  it("dispatches nothing when the selected date matches the current start date (no redundant history entry)", () => {
    const { onCommand } = renderDateControl({ startDate: "2026-10-03", dayCount: 14 });
    fireEvent.change(screen.getByLabelText("Trip start date"), { target: { value: "2026-10-03" } });

    expect(onCommand).not.toHaveBeenCalled();
  });

  it("Done closes the control without dispatching a command", () => {
    const onCommand = vi.fn<(command: TripCommand) => void>();
    const onClose = vi.fn();
    render(
      <TripDateControl tripId={TRIP_ID} startDate="2026-10-03" dayCount={14} onCommand={onCommand} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(onCommand).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
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

  it("resyncs the staged start input when startDate changes externally (e.g. a collaborator's concurrent edit)", () => {
    const onCommand = vi.fn();
    const { rerender } = render(
      <TripDateControl tripId={TRIP_ID} startDate="2026-07-07" dayCount={3} onCommand={onCommand} />,
    );
    expect((screen.getByLabelText("Trip start date") as HTMLInputElement).value).toBe("2026-07-07");

    // Simulate a collaborator's edit landing via useTrip() context while this
    // user still has the Settings sheet open — the parent re-renders with a
    // new startDate prop without the control unmounting.
    rerender(<TripDateControl tripId={TRIP_ID} startDate="2026-08-01" dayCount={3} onCommand={onCommand} />);

    // The displayed value must reflect the NEW prop, not whatever this user
    // had staged before the external update arrived. Prop-wins-on-change is
    // intentional here: silently discarding an in-progress local edit is far
    // safer than letting a stale "Done" click stomp a collaborator's newer
    // data, so no merge/preserve-local-edits behavior is implemented.
    expect((screen.getByLabelText("Trip start date") as HTMLInputElement).value).toBe("2026-08-01");
  });
});
