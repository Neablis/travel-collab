import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setupServer } from "msw/node";
import { http, HttpResponse } from "msw";
import { tripAccessFixture, tripMemberProfileFactory } from "@tc/factories";
import { PeopleProvider } from "@/components/pages/people";
import { UnscheduledRack } from "./UnscheduledRack";

afterEach(cleanup);

// Task 3.3 added `timeWindow` to RackItem: unscheduling strips a stop's
// times, so a parked stop usually has none — but one created unscheduled can
// still carry a window, and the card has to tell the truth about which.
const items = [
  { activityId: "a1", title: "Souvenir shopping", area: "Rochester", timeWindow: null, bookedBy: null, from: null, day: null, badge: null },
  { activityId: "a2", title: "Second breakfast", area: null, timeWindow: { start: "08:00", end: "09:00" }, bookedBy: null, from: null, day: null, badge: null },
];

function renderRack(over: Partial<React.ComponentProps<typeof UnscheduledRack>> = {}) {
  return render(
    <UnscheduledRack items={items} open={false} onToggle={vi.fn()} onEdit={vi.fn()} onCreate={vi.fn()} {...over} />,
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
      screen.getByText("Nothing parked. Drag a stop down here to take it off the schedule, or double-click to add one."),
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

  // M41 D4: the card is the control. Its editor moves, times and removes it.
  it("opens a card's stop when the card is tapped, and carries no controls of its own", async () => {
    const onEdit = vi.fn();
    renderRack({ open: true, onEdit });

    const card = screen.getAllByTestId("rack-card")[0]!;
    expect(within(card).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Edit Souvenir shopping",
    ]);
    expect(within(card).queryByRole("combobox")).toBeNull();
    // The button covers the card; jsdom does no hit-testing, so it is clicked
    // by its name rather than through the text painted over it.
    await userEvent.click(within(card).getByRole("button", { name: "Edit Souvenir shopping" }));

    expect(onEdit).toHaveBeenCalledWith("a1");
  });

  // M41 D1: a parked stop is made where it will live, with the river's gesture.
  it("makes a parked stop on a double-click of its empty space, and not on a card", async () => {
    const onCreate = vi.fn();
    renderRack({ open: true, onCreate });

    await userEvent.dblClick(screen.getAllByTestId("rack-card")[0]!);
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.dblClick(screen.getByTestId("rack-cards"));
    expect(onCreate).toHaveBeenCalledTimes(1);
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
      from: null,
      day: day3,
      badge: { label: "To book", variant: "warning" as const },
    },
    ...items,
  ];

  // Named, not headed: *"Drop the header, i can see the Day 3 in the card
  // already"* (Mitchell, PR #269 preview). The group's name is for assistive
  // tech and the chip's reveal; the card's own tag is what a sighted user reads.
  it("groups each day's stops under the day's name, after the stops with no day", () => {
    renderRack({ open: true, items: withDays });

    const group = screen.getByRole("group", { name: "Day 3 · Kyoto" });
    expect(within(group).getByText("Nishiki market")).toBeTruthy();
    expect(screen.queryByText("Day 3 · Kyoto")).toBeNull();
    expect(within(group).queryByText("Souvenir shopping")).toBeNull();
    const titles = screen.getAllByTestId("rack-card").map((card) => card.textContent);
    expect(titles.findIndex((t) => t?.includes("Nishiki market"))).toBe(2);
  });

  // Decision 3C: the day-less stops sit in a "No day" section, and it is there
  // even when none are day-less — it is the drop target that takes a stop off
  // its day, so it has to exist to be dropped on.
  it("puts the day-less stops under No day, and keeps an empty No day to drop on", () => {
    renderRack({ open: true, items: withDays });
    const noDay = screen.getByRole("group", { name: "No day" });
    expect(within(noDay).getByText("Souvenir shopping")).toBeTruthy();
    expect(within(noDay).queryByText("Nishiki market")).toBeNull();
    cleanup();

    renderRack({ open: true, items: withDays.slice(0, 1) });
    expect(within(screen.getByRole("group", { name: "No day" })).getByText(/drop a stop here to take it off its day/i)).toBeTruthy();
  });

  it("tags the card itself with its day, so it still says so when lifted out", () => {
    renderRack({ open: true, items: withDays });

    const card = screen.getAllByTestId("rack-card").find((c) => c.textContent?.includes("Nishiki market"))!;
    expect(within(card).getByText("Day 3")).toBeTruthy();
  });

  // What the board's card said for an untimed stop, kept now that the rack is
  // where one is drawn: its kind.
  it("wears the stop's kind badge", () => {
    renderRack({ open: true, items: withDays });

    const card = screen.getAllByTestId("rack-card").find((c) => c.textContent?.includes("Nishiki market"))!;
    expect(within(card).getByText("To book")).toBeTruthy();
  });

  // M41 D6: the day a parked stop left, when its move recorded one.
  it("says which day a parked stop left, and nothing when that is not known", () => {
    renderRack({ open: true, items: [{ ...items[0]!, from: "Day 2" }, items[1]!] });

    const [left, unknown] = screen.getAllByTestId("rack-card");
    expect(within(left!).getByText("From Day 2")).toBeTruthy();
    expect(within(unknown!).queryByText(/^From /)).toBeNull();
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
// A viewer is expressed as `onEdit: undefined`, not a `readOnly` flag:
// TripBoardScreen withholds the callback rather than passing a flag (ADR-031),
// so absent-callback IS the signal the component has to read. Passing a flag
// here would test a mechanism the parent never uses.
describe("UnscheduledRack — a viewer's drawer", () => {
  it("still lists what is parked", () => {
    renderRack({ open: true, onEdit: undefined, onCreate: undefined });

    expect(screen.getByText("Souvenir shopping")).toBeTruthy();
    expect(screen.getAllByTestId("rack-card")).toHaveLength(2);
  });

  it("makes no card draggable", () => {
    renderRack({ open: true, onEdit: undefined, onCreate: undefined });
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

  it("opens no card, and makes nothing on a double-click", async () => {
    renderRack({ open: true, onEdit: undefined, onCreate: undefined });
    expect(screen.queryAllByRole("button", { name: /^Edit / })).toHaveLength(0);
  });
  // The empty state's instruction ("Drag a stop down here…") is only true for
  // someone who can drag, so a viewer gets the state without the instruction.
  it("drops the drag instruction from the empty state", () => {
    renderRack({ open: true, items: [], onEdit: undefined, onCreate: undefined });

    expect(screen.getByText("Nothing parked.")).toBeTruthy();
    expect(screen.queryByText(/Drag a stop down here/)).toBeNull();
  });
});

// M38 part 3: "Parked by" printed the parker's raw user id. It names them the
// way every person surface does, from the trip's members (`PeopleProvider`).
describe("UnscheduledRack — who parked a stop", () => {
  const server = setupServer();
  beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  const parker = "6b1f0c7e-2d4a-4c8e-9f1a-3e5d7c9b4f2a";
  const parked = [{ ...items[0]!, bookedBy: parker }];

  // M38: and beside the name, their chip — the glyph they picked.
  it("names the person who parked it, by the name and chip they chose", async () => {
    const tripId = crypto.randomUUID();
    server.use(
      http.get("/api/trips/:tripId/access", () =>
        HttpResponse.json({
          access: tripAccessFixture({
            tripId,
            members: [
              tripMemberProfileFactory.build({ userId: parker, role: "owner", name: "Dana Reyes", displayName: "Dee", avatar: "tent", color: "teal" }),
            ],
          }),
        }),
      ),
    );
    render(
      <PeopleProvider tripId={tripId}>
        <UnscheduledRack items={parked} open onToggle={vi.fn()} />
      </PeopleProvider>,
    );

    expect(await screen.findByText("Parked by Dee")).toBeTruthy();
    expect(screen.queryByText(new RegExp(parker))).toBeNull();
    expect(screen.getByTestId("rack-card").innerHTML).toContain("lucide-tent");
  });

  // Before the members land, or for someone who has left: a handle, never the id.
  it("never prints the raw id while it does not know the name", () => {
    renderRack({ open: true, items: parked });

    expect(screen.getByText("Parked by Traveler 9b4f2a")).toBeTruthy();
    expect(screen.queryByText(new RegExp(parker))).toBeNull();
  });
});
