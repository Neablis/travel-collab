import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UnscheduledRack } from "./UnscheduledRack";

afterEach(cleanup);

// Task 3.3 added `timeWindow` to RackItem: unscheduling strips a stop's
// times, so a parked stop usually has none — but one created unscheduled can
// still carry a window, and the card has to tell the truth about which.
const items = [
  { activityId: "a1", title: "Souvenir shopping", area: "Rochester", timeWindow: null, bookedBy: null, day: null, badge: null },
  { activityId: "a2", title: "Second breakfast", area: null, timeWindow: { start: "08:00", end: "09:00" }, bookedBy: null, day: null, badge: null },
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
    // 12-hour, via lib/time's toClockRange (Mitchell, PR #55: "this is still
    // military time"). Storage is still 24-hour "08:00"/"09:00" — this is the
    // rendering only.
    expect(screen.getByText("8 am – 9 am")).toBeTruthy();
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

// PR #269: an untimed stop keeps its day, and the rack draws it under that day
// — Mitchell: "not sure how we should show the date ownership still in the
// unscheduled rack". Day-less stops come first, whatever order they arrive in.
describe("UnscheduledRack — a day's untimed stops", () => {
  const day3 = { dayId: "d3", tag: "Day 3", heading: "Day 3 · Kyoto" };
  const withDays = [
    {
      activityId: "a3",
      title: "Nishiki market",
      area: null,
      timeWindow: null,
      bookedBy: null,
      day: day3,
      badge: { label: "To book", variant: "warning" as const },
    },
    ...items,
  ];

  it("heads each day's group with the day, after the stops with no day", () => {
    renderRack({ open: true, items: withDays });

    const group = screen.getByRole("group", { name: "Day 3 · Kyoto" });
    expect(within(group).getByText("Nishiki market")).toBeTruthy();
    expect(within(group).queryByText("Souvenir shopping")).toBeNull();
    const titles = screen.getAllByTestId("rack-card").map((card) => card.textContent);
    expect(titles.findIndex((t) => t?.includes("Nishiki market"))).toBe(2);
  });

  it("tags the card itself with its day, so it still says so when lifted out", () => {
    renderRack({ open: true, items: withDays });

    const card = screen.getAllByTestId("rack-card").find((c) => c.textContent?.includes("Nishiki market"))!;
    expect(within(card).getByText("Day 3")).toBeTruthy();
  });

  // What the board's card said about an untimed stop, kept now that the rack
  // is where one is drawn: a pending stop is very often an untimed one.
  it("wears the stop's kind badge", () => {
    renderRack({ open: true, items: withDays });

    const card = screen.getAllByTestId("rack-card").find((c) => c.textContent?.includes("Nishiki market"))!;
    expect(within(card).getByText("To book")).toBeTruthy();
  });

  it("counts every card it holds, day-less and untimed alike", () => {
    renderRack({ items: withDays });

    expect(within(screen.getByRole("button", { name: /unscheduled/i })).getByText("3")).toBeTruthy();
  });

  // jsdom implements no `scrollIntoView`, so it is stubbed on the prototype and
  // the element it was called on is read back from the mock.
  it("scrolls the day's group into view when a chip reveals it", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      renderRack({ open: true, items: withDays, reveal: { dayId: "d3", seq: 1 } });

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("group", { name: "Day 3 · Kyoto" }));
    } finally {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    }
  });
});

// docs/reviews/2026-08-28-m11-pr71-review.md §5: the drawer had no viewer
// awareness, so a viewer could drag a parked stop onto a day (it moved and
// snapped back) or pick a day from the select — both real MoveActivity +
// UpdateActivity pairs the server refuses. What is parked STAYS listed: that is
// content, and reading it is not a write. Each absence is paired with its
// editor mirror above, so these are statements about the role.
//
// A viewer is expressed as `onAssign: undefined`, not a `readOnly` flag:
// TripBoardScreen withholds the callback rather than passing a flag (ADR-031),
// so absent-callback IS the signal the component has to read. Passing a flag
// here would test a mechanism the parent never uses.
describe("UnscheduledRack — a viewer's drawer", () => {
  it("still lists what is parked", () => {
    renderRack({ open: true, onAssign: undefined });

    expect(screen.getByText("Souvenir shopping")).toBeTruthy();
    expect(screen.getAllByTestId("rack-card")).toHaveLength(2);
  });

  it("makes no card draggable", () => {
    renderRack({ open: true, onAssign: undefined });
    // pdnd's `draggable()` sets this attribute; its absence is the missing
    // registration, not a styling difference.
    for (const card of screen.getAllByTestId("rack-card")) {
      expect(card.getAttribute("draggable")).toBeNull();
    }
  });

  it("makes every card draggable for an editor", () => {
    renderRack({ open: true });
    for (const card of screen.getAllByTestId("rack-card")) {
      expect(card.getAttribute("draggable")).toBe("true");
    }
  });

  it("withholds Add to day", () => {
    renderRack({ open: true, onAssign: undefined });
    expect(screen.queryAllByRole("combobox", { name: "Add to day" })).toHaveLength(0);
  });
  // The empty state's instruction ("Drag a stop down here…") is only true for
  // someone who can drag, so a viewer gets the state without the instruction.
  it("drops the drag instruction from the empty state", () => {
    renderRack({ open: true, items: [], onAssign: undefined });

    expect(screen.getByText("Nothing parked.")).toBeTruthy();
    expect(screen.queryByText(/Drag a stop down here/)).toBeNull();
  });
});
