import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ActivityView } from "@tc/contracts";
import { activityFactory, locationFactory } from "@tc/factories";
import { DayRiver, type RiverGestures } from "./DayRiver";
import { riverAxis } from "./riverLayout";

// M29 part 2 — how each kind of stop is drawn on the river (SPEC §36.9b). The
// styling itself is the colour wall's to own; what is asserted here is what a
// person can tell apart without it: the word in the block's corner, and the
// kind in the name a screen reader hears. The geometry is `riverLayout.test.ts`.

function renderRiver(stops: ActivityView[], readOnly = false, gestures?: RiverGestures) {
  const activities = Object.fromEntries(stops.map((s) => [s.activityId, s]));
  render(
    <DayRiver
      title="Day 1"
      dayId="day-1"
      axis={riverAxis(stops.map((s) => s.timeWindow))}
      activityIds={stops.map((s) => s.activityId)}
      activities={activities}
      accent="brand"
      conflictIds={new Set()}
      overlaps={new Map()}
      overlapPartners={new Map()}
      currency="EUR"
      onEditActivity={vi.fn()}
      onRemoveActivity={vi.fn()}
      onDismissOverlap={vi.fn()}
      focusedTag={null}
      onToggleTag={vi.fn()}
      readOnly={readOnly}
      gestures={gestures}
    />,
  );
}

const block = (id: string) => within(screen.getByTestId(`activity-card-${id}`));

describe("a river block says how locked in its stop is", () => {
  const planned = activityFactory.build({ title: "Museum", kind: "planned", timeWindow: { start: "09:00", end: "10:00" } });
  const toBook = activityFactory.build({ title: "Sushi", kind: "pending", pendingReason: "book", timeWindow: { start: "11:00", end: "12:00" } });
  const maybe = activityFactory.build({ title: "Garden", kind: "pending", pendingReason: "maybe", timeWindow: { start: "13:00", end: "14:00" } });
  const pending = activityFactory.build({ title: "Bar", kind: "pending", pendingReason: null, timeWindow: { start: "15:00", end: "16:00" } });
  const transit = activityFactory.build({ title: "Shinkansen", kind: "transit", mode: "train", timeWindow: { start: "16:30", end: "18:45" } });

  it("names every kind, and marks each pending and transit block in its corner", () => {
    renderRiver([planned, toBook, maybe, pending, transit]);

    expect(screen.getByRole("button", { name: "Edit Museum, 9 am – 10 am, Planned" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Sushi, 11 am – 12 pm, To book" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Garden, 1 pm – 2 pm, Maybe" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Bar, 3 pm – 4 pm, Pending" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit Shinkansen, 4:30 pm – 6:45 pm, Train, 2 h 15 m" })).toBeTruthy();

    expect(block(toBook.activityId).getByText("To book")).toBeTruthy();
    expect(block(maybe.activityId).getByText("Maybe")).toBeTruthy();
    expect(block(pending.activityId).getByText("Pending")).toBeTruthy();
    // A transit leg leads with how it travels, and its tag is how long.
    expect(block(transit.activityId).getByText("Train · Shinkansen")).toBeTruthy();
    expect(block(transit.activityId).getByText("2 h 15 m")).toBeTruthy();
  });

  it("leaves a planned block unmarked — it is the default, and a word on every stop separates nothing", () => {
    renderRiver([planned]);
    for (const word of ["Planned", "To book", "Maybe", "Pending", "Overlap"]) {
      expect(block(planned.activityId).queryByText(word)).toBeNull();
    }
  });

  it("says the same to a reader, who gets no edit button", () => {
    renderRiver([toBook], true);
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
    expect(screen.getByText("Sushi, 11 am – 12 pm, To book")).toBeTruthy();
  });
});

describe("what a block has room to say", () => {
  it("lets a stop too short to draw its tags still focus one", () => {
    // 30 minutes is 20px of axis, drawn at the 24px minimum — well under the
    // 70px SPEC §36.9b draws tags from. Every lodging stop in the demo is this
    // short, and this chip was the only way to focus `lodging` on a desktop.
    const short = activityFactory.build({ title: "Check in", tags: ["lodging"], timeWindow: { start: "09:00", end: "09:30" } });
    const long = activityFactory.build({ title: "Dinner", tags: ["meal"], timeWindow: { start: "19:00", end: "21:00" } });
    renderRiver([short, long]);

    expect(block(short.activityId).getByRole("button", { name: "Dim everything that is not lodging" })).toBeTruthy();
    expect(block(long.activityId).getByRole("button", { name: "Dim everything that is not meal" })).toBeTruthy();
  });

  it("names the place, the cost and the tags, which the drawn block may not show", () => {
    // Narrow (it overlaps) and compact (30 minutes): the picture has room for
    // the title alone, so the name is the only place the rest can be heard.
    const lunch = activityFactory.build({
      title: "Ramen",
      timeWindow: { start: "12:00", end: "12:30" },
      location: locationFactory.build({ name: "Ichiran, Shibuya", city: "Tokyo", countryCode: "JP" }),
      cost: { amountMinor: 1850, currency: "EUR" },
      tags: ["meal", "ticketed"],
    });
    const walk = activityFactory.build({ title: "Walk", timeWindow: { start: "12:00", end: "13:00" } });
    renderRiver([lunch, walk]);

    expect(
      screen.getByRole("button", { name: "Edit Ramen, 12 pm – 12:30 pm, Planned, Ichiran, Tokyo, Japan, €18.50, tagged Meal and Ticketed" }),
    ).toBeTruthy();
  });
});

describe("the order a river is read in", () => {
  it("is the order of the clock, not of the day's list", () => {
    // Listed evening first, as a drop at a new time can leave them; two stops
    // at 09:00 as well, so the tie is broken by lane (the longer takes the left).
    const dinner = activityFactory.build({ title: "Dinner", timeWindow: { start: "19:00", end: "20:00" } });
    const coffee = activityFactory.build({ title: "Coffee", timeWindow: { start: "09:00", end: "09:30" } });
    const museum = activityFactory.build({ title: "Museum", timeWindow: { start: "09:00", end: "11:00" } });
    const lunch = activityFactory.build({ title: "Lunch", timeWindow: { start: "12:00", end: "13:00" } });
    renderRiver([dinner, coffee, lunch, museum]);

    const titles = within(screen.getByRole("list", { name: "Day 1 timeline" }))
      .getAllByRole("button", { name: /^Edit / })
      .map((button) => button.getAttribute("aria-label")?.split(",")[0]);
    expect(titles).toEqual(["Edit Museum", "Edit Coffee", "Edit Lunch", "Edit Dinner"]);
  });
});

// M29 part 3 — the gestures on empty time. The arithmetic (snap, clamps) is
// riverGestures.test.ts; what is asserted here is that the right pointer on the
// right element reaches it, and that nothing else does. jsdom lays nothing out,
// so the river's top edge is at 0 and a pointer's clientY IS its y on the
// axis — 44px an hour from the axis's first hour, here 9:00.
describe("gestures on empty time", () => {
  const morning = activityFactory.build({ title: "Museum", timeWindow: { start: "09:00", end: "10:00" } });
  const evening = activityFactory.build({ title: "Dinner", timeWindow: { start: "17:00", end: "18:00" } });
  const gestures = () => ({ onCreateAt: vi.fn(), onResize: vi.fn(), canPlace: () => true }) satisfies RiverGestures;
  const hour = (h: number) => (h - 9) * 44;

  it("double-click on empty time opens an hour at the quarter hour under the pointer — and not on a block", () => {
    const g = gestures();
    renderRiver([morning, evening], false, g);

    fireEvent.doubleClick(screen.getByTestId(`activity-card-${morning.activityId}`), { clientY: hour(9.5) });
    expect(g.onCreateAt).not.toHaveBeenCalled();

    // 10:20 is nearer 10:15 than 10:30.
    fireEvent.doubleClick(screen.getByTestId("day-river"), { clientY: hour(10 + 20 / 60) });
    expect(g.onCreateAt).toHaveBeenCalledExactlyOnceWith({ start: "10:15", end: "11:15" });
  });

  it("a sketch draws its window while the pointer moves, opens the add sheet with it on release, and is no double-click", () => {
    const g = gestures();
    renderRiver([morning, evening], false, g);
    const river = screen.getByTestId("day-river");

    fireEvent.pointerDown(river, { button: 0, clientY: hour(11) });
    fireEvent.pointerMove(window, { clientY: hour(13.5) });
    expect(screen.getByTestId("river-ghost").textContent).toBe("11 am – 1:30 pm");

    fireEvent.pointerUp(window, { clientY: hour(13.5) });
    // The release is a click; a click just after another is a double-click.
    fireEvent.doubleClick(river, { clientY: hour(13.5) });
    expect(g.onCreateAt).toHaveBeenCalledExactlyOnceWith({ start: "11:00", end: "13:30" });
    expect(screen.queryByTestId("river-ghost")).toBeNull();
  });

  it("a sketch under half an hour opens nothing", () => {
    const g = gestures();
    renderRiver([morning, evening], false, g);

    fireEvent.pointerDown(screen.getByTestId("day-river"), { button: 0, clientY: hour(11) });
    fireEvent.pointerMove(window, { clientY: hour(11.25) });
    fireEvent.pointerUp(window);
    expect(g.onCreateAt).not.toHaveBeenCalled();
  });

  it("a read-only river offers none of it: no grip, and a double-click does nothing", () => {
    const g = gestures();
    renderRiver([morning], true, g);

    fireEvent.doubleClick(screen.getByTestId("day-river"), { clientY: hour(9.5) });
    expect(g.onCreateAt).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Drag to change when it ends")).toBeNull();
  });
});
