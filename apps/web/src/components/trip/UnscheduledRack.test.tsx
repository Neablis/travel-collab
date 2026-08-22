import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnscheduledRack } from "./UnscheduledRack";

afterEach(cleanup);

// Task 3.3 added `timeWindow` to RackItem: unscheduling strips a stop's
// times, so a parked stop usually has none — but one created unscheduled can
// still carry a window, and the card has to tell the truth about which.
const items = [
  { activityId: "a1", title: "Souvenir shopping", area: "Rochester", timeWindow: null },
  { activityId: "a2", title: "Second breakfast", area: null, timeWindow: { start: "08:00", end: "09:00" } },
];
const dayOptions = [{ value: "d1", label: "Day 1 · Sep 5" }, { value: "d2", label: "Day 2 · Sep 6" }];

function renderRack(over: Partial<React.ComponentProps<typeof UnscheduledRack>> = {}) {
  return render(
    <UnscheduledRack items={items} dayOptions={dayOptions} open={false} onToggle={vi.fn()} onAssign={vi.fn()} {...over} />,
  );
}

describe("UnscheduledRack", () => {
  it("is collapsed by default, showing the label and the count", () => {
    renderRack();

    expect(screen.getByText("Unscheduled")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("Souvenir shopping")).toBeNull();
  });

  it("toggles when the bar is clicked", async () => {
    const onToggle = vi.fn();
    renderRack({ onToggle });

    await userEvent.click(screen.getByRole("button", { name: /unscheduled/i }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("lists one card per parked stop when open", () => {
    renderRack({ open: true });

    expect(screen.getByText("Souvenir shopping")).toBeTruthy();
    expect(screen.getByText("Second breakfast")).toBeTruthy();
  });

  it("shows the design's empty state when nothing is parked", () => {
    renderRack({ open: true, items: [] });

    expect(
      screen.getByText("Nothing parked. Drag a stop down here to take it off the schedule without losing it."),
    ).toBeTruthy();
  });

  it("says 'No time yet' for a stop with no window, and shows the window when there is one", () => {
    renderRack({ open: true });

    expect(screen.getByText("No time yet")).toBeTruthy();
    expect(screen.getByText("08:00–09:00")).toBeTruthy();
  });

  it("makes every card a drag handle the board's monitor can pick up", () => {
    renderRack({ open: true });

    expect(screen.getAllByTestId("rack-card")).toHaveLength(2);
  });

  it("assigns a stop to the chosen day", async () => {
    const onAssign = vi.fn();
    renderRack({ open: true, onAssign });

    const selects = screen.getAllByRole("combobox", { name: "Add to day" });
    await userEvent.selectOptions(selects[0]!, "d2");

    expect(onAssign).toHaveBeenCalledWith("a1", "d2");
  });
});
