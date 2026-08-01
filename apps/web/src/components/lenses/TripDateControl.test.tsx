import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripCommand } from "@tc/contracts";
import { TripDateControl } from "./TripDateControl";

const TRIP_ID = "7d9a1f8e-0000-4000-8000-00000000000a";

afterEach(cleanup);

describe("TripDateControl", () => {
  it("setting only a start date and committing dispatches SetTripDates with the end date untouched", async () => {
    const onCommand = vi.fn<(command: TripCommand) => void>();
    render(<TripDateControl tripId={TRIP_ID} startDate={null} onCommand={onCommand} />);
    fireEvent.change(screen.getByLabelText(/start date/i), { target: { value: "2026-10-12" } });
    fireEvent.click(screen.getByRole("button", { name: /set dates/i }));
    expect(onCommand).toHaveBeenCalledWith({
      type: "SetTripDates",
      tripId: TRIP_ID,
      startDate: "2026-10-12",
      endDate: null,
      newDayIds: [],
    });
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

  it("dispatches SetTripDates with enough fresh day ids to cover the range", async () => {
    const onCommand = vi.fn();
    render(<TripDateControl tripId={TRIP_ID} startDate={null} endDate={null} dayCount={1} onCommand={onCommand} />);
    await userEvent.type(screen.getByLabelText(/start date/i), "2026-07-07");
    await userEvent.type(screen.getByLabelText(/end date/i), "2026-07-09");
    await userEvent.click(screen.getByRole("button", { name: /set dates/i }));

    const command = onCommand.mock.calls[0]![0];
    expect(command.type).toBe("SetTripDates");
    expect(command.startDate).toBe("2026-07-07");
    expect(command.endDate).toBe("2026-07-09");
    // 3-day range against 1 existing day → 2 new ids needed; send a safe surplus.
    expect(command.newDayIds.length).toBeGreaterThanOrEqual(2);
  });

  // Correction to the task brief: this repo's Dialog primitive
  // (apps/web/src/components/ui/dialog.tsx) wraps plain Radix Dialog, not
  // AlertDialog, so it renders role="dialog" — never "alertdialog".
  it("warns before shrinking a range that would drop days", async () => {
    const onCommand = vi.fn();
    render(
      <TripDateControl tripId={TRIP_ID} startDate="2026-07-07" endDate="2026-07-09" dayCount={3} onCommand={onCommand} />,
    );
    await userEvent.clear(screen.getByLabelText(/end date/i));
    await userEvent.type(screen.getByLabelText(/end date/i), "2026-07-07");
    await userEvent.click(screen.getByRole("button", { name: /set dates/i }));
    expect(screen.getByRole("dialog").textContent).toMatch(/2 days.*backlog/i);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("only dispatches SetTripDates after the shrink is confirmed", async () => {
    const onCommand = vi.fn();
    render(
      <TripDateControl tripId={TRIP_ID} startDate="2026-07-07" endDate="2026-07-09" dayCount={3} onCommand={onCommand} />,
    );
    await userEvent.clear(screen.getByLabelText(/end date/i));
    await userEvent.type(screen.getByLabelText(/end date/i), "2026-07-07");
    await userEvent.click(screen.getByRole("button", { name: /set dates/i }));
    await userEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onCommand).toHaveBeenCalledWith({
      type: "SetTripDates",
      tripId: TRIP_ID,
      startDate: "2026-07-07",
      endDate: "2026-07-07",
      newDayIds: [],
    });
  });

  it("resyncs the staged inputs when startDate/endDate props change externally (e.g. a collaborator's concurrent edit)", () => {
    const onCommand = vi.fn();
    const { rerender } = render(
      <TripDateControl tripId={TRIP_ID} startDate="2026-07-07" endDate="2026-07-09" dayCount={3} onCommand={onCommand} />,
    );
    expect((screen.getByLabelText(/start date/i) as HTMLInputElement).value).toBe("2026-07-07");
    expect((screen.getByLabelText(/end date/i) as HTMLInputElement).value).toBe("2026-07-09");

    // Simulate a collaborator's edit landing via useTrip() context while this
    // user still has the Settings sheet open — the parent re-renders with
    // new startDate/endDate props without the control unmounting.
    rerender(
      <TripDateControl tripId={TRIP_ID} startDate="2026-08-01" endDate="2026-08-05" dayCount={5} onCommand={onCommand} />,
    );

    // The displayed values must reflect the NEW props, not whatever this
    // user had staged before the external update arrived. Prop-wins-on-change
    // is intentional here: silently discarding an in-progress local edit is
    // far safer than letting a stale "Set dates" click stomp a collaborator's
    // newer data, so no merge/preserve-local-edits behavior is implemented.
    expect((screen.getByLabelText(/start date/i) as HTMLInputElement).value).toBe("2026-08-01");
    expect((screen.getByLabelText(/end date/i) as HTMLInputElement).value).toBe("2026-08-05");
  });
});
