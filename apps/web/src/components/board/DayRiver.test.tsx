import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityView } from "@tc/contracts";
import { activityFactory, locationFactory } from "@tc/factories";
import { DayRiver, type RiverGestures } from "./DayRiver";
import { RIVER_TOUCH_HOLD_MS } from "./riverGestures";
import { riverAxis } from "./riverLayout";

// The real adapter, wrapped so a test can ask a block the question the browser
// asks it at dragstart: may this stop be picked up now? jsdom has no native
// drag to fire, and `canDrag` is exactly what a held grip gates.
const canDragOf = vi.hoisted(() => new Map<Element, () => boolean>());
vi.mock("@atlaskit/pragmatic-drag-and-drop/element/adapter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@atlaskit/pragmatic-drag-and-drop/element/adapter")>();
  return {
    ...actual,
    draggable: (args: Parameters<typeof actual.draggable>[0]) => {
      canDragOf.set(args.element, () => args.canDrag?.({ element: args.element, dragHandle: null, input: {} as never }) ?? true);
      return actual.draggable(args);
    },
  };
});

// M29 part 2 — how each kind of stop is drawn on the river (SPEC §36.9b). The
// styling itself is the colour wall's to own; what is asserted here is what a
// person can tell apart without it: the word in the block's corner, and the
// kind in the name a screen reader hears. The geometry is `riverLayout.test.ts`.

function renderRiver(stops: ActivityView[], readOnly = false, gestures?: RiverGestures, onEditActivity: (id: string) => void = vi.fn()) {
  const activities = Object.fromEntries(stops.map((s) => [s.activityId, s]));
  return render(
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
      onEditActivity={onEditActivity}
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
  const gestures = () => ({ onCreateAt: vi.fn(), onResize: vi.fn(), canPlace: () => true, onDropAt: vi.fn() }) satisfies RiverGestures;
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
    fireEvent.pointerMove(window, { buttons: 1, clientY: hour(13.5) });
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
    fireEvent.pointerMove(window, { buttons: 1, clientY: hour(11.25) });
    fireEvent.pointerUp(window);
    expect(g.onCreateAt).not.toHaveBeenCalled();
  });

  // A release the river never hears — over another window, after a tab
  // switch, or after the river is gone — ends the sketch and opens nothing.
  // Each case ends with the pointerup a plain listener would still commit on.
  describe("a sketch whose release goes unheard opens nothing", () => {
    const sketchTo = (g: RiverGestures) => {
      const view = renderRiver([morning, evening], false, g);
      fireEvent.pointerDown(screen.getByTestId("day-river"), { button: 0, clientY: hour(11) });
      fireEvent.pointerMove(window, { buttons: 1, clientY: hour(13) });
      return view;
    };

    it("when the pointer comes back with no button down", () => {
      const g = gestures();
      sketchTo(g);
      fireEvent.pointerMove(window, { buttons: 0, clientY: hour(14) });
      expect(screen.queryByTestId("river-ghost")).toBeNull();
      fireEvent.pointerUp(window);
      expect(g.onCreateAt).not.toHaveBeenCalled();
    });

    it("when the window loses focus mid-sketch", () => {
      const g = gestures();
      sketchTo(g);
      fireEvent.blur(window);
      expect(screen.queryByTestId("river-ghost")).toBeNull();
      fireEvent.pointerUp(window);
      expect(g.onCreateAt).not.toHaveBeenCalled();
    });

    it("when the river unmounts mid-sketch", () => {
      const g = gestures();
      sketchTo(g).unmount();
      fireEvent.pointerUp(window);
      expect(g.onCreateAt).not.toHaveBeenCalled();
    });
  });

  // A block cannot be dragged while its grip is held, or pulling the grip
  // would carry the whole stop off. Every way the resize ends has to hand the
  // drag back — not only a pointerup — or the stop can never be moved again.
  describe("a resize that ends without a pointerup gives the block its drag back", () => {
    const canDrag = (id: string) => canDragOf.get(screen.getByTestId(`activity-card-${id}`))!();
    const resizeTo = (g: RiverGestures) => {
      renderRiver([morning, evening], false, g);
      fireEvent.pointerDown(block(morning.activityId).getByTitle("Drag to change when it ends"), { button: 0, clientY: hour(10) });
      fireEvent.pointerMove(window, { buttons: 1, clientY: hour(11) });
      expect(canDrag(morning.activityId)).toBe(false);
    };

    it("when Escape cancels it", () => {
      const g = gestures();
      resizeTo(g);
      fireEvent.keyDown(window, { key: "Escape" });
      expect(g.onResize).not.toHaveBeenCalled();
      expect(canDrag(morning.activityId)).toBe(true);
    });

    it("when the pointer comes back with no button down", () => {
      const g = gestures();
      resizeTo(g);
      fireEvent.pointerMove(window, { buttons: 0, clientY: hour(11) });
      expect(canDrag(morning.activityId)).toBe(true);
    });
  });

  it("a read-only river offers none of it: no grip, and a double-click does nothing", () => {
    const g = gestures();
    renderRiver([morning], true, g);

    fireEvent.doubleClick(screen.getByTestId("day-river"), { clientY: hour(9.5) });
    expect(g.onCreateAt).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Drag to change when it ends")).toBeNull();
  });

  // M29 phone — the same gestures under a finger, where each starts with a
  // hold so that a swipe is still a scroll. What a real finger does to a real
  // page (the scroll itself, the hit-testing across rivers) is
  // `m26-phone-plan.spec.ts`; here, that each touch path reaches the gesture it
  // stands for, and that a press that did not hold reaches none of them.
  describe("under a finger", () => {
    const finger = { pointerType: "touch", pointerId: 7, button: 0, clientX: 120 } as const;
    const hold = () => act(() => void vi.advanceTimersByTime(RIVER_TOUCH_HOLD_MS));
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
      vi.useRealTimers();
      Reflect.deleteProperty(document, "elementFromPoint");
    });

    it("a held press on empty time, let go, opens an hour there, and a tap or two opens nothing", () => {
      const g = gestures();
      renderRiver([morning, evening], false, g);
      const river = screen.getByTestId("day-river");

      // A tap, and a second one: two taps are not the mouse's double-click.
      fireEvent.pointerDown(river, { ...finger, clientY: hour(11) });
      fireEvent.pointerUp(window, finger);
      fireEvent.doubleClick(river, { clientY: hour(11) });
      hold();
      expect(g.onCreateAt).not.toHaveBeenCalled();

      fireEvent.pointerDown(river, { ...finger, clientY: hour(12 + 5 / 60) });
      hold();
      expect(screen.getByTestId("river-ghost").textContent).toBe("12 pm – 1 pm");
      fireEvent.pointerUp(window, finger);
      expect(g.onCreateAt).toHaveBeenCalledExactlyOnceWith({ start: "12:00", end: "13:00" });
    });

    it("a held press dragged across empty time sketches that length", () => {
      const g = gestures();
      renderRiver([morning, evening], false, g);

      fireEvent.pointerDown(screen.getByTestId("day-river"), { ...finger, clientY: hour(13) });
      hold();
      fireEvent.pointerMove(window, { ...finger, buttons: 1, clientY: hour(15.5) });
      expect(screen.getByTestId("river-ghost").textContent).toBe("1 pm – 3:30 pm");
      fireEvent.pointerUp(window, finger);
      expect(g.onCreateAt).toHaveBeenCalledExactlyOnceWith({ start: "13:00", end: "15:30" });
    });

    it("a press that moves before the hold is a swipe: the page scrolls, and nothing is drawn or opened", () => {
      const g = gestures();
      renderRiver([morning, evening], false, g);
      const river = screen.getByTestId("day-river");

      fireEvent.pointerDown(river, { ...finger, clientY: hour(11) });
      fireEvent.pointerMove(window, { ...finger, buttons: 1, clientY: hour(11) - 30 });
      // `fireEvent` returns false when a listener cancelled the event, and a
      // cancelled touchmove is a page that did not scroll.
      expect(fireEvent.touchMove(river)).toBe(true);
      hold();
      expect(screen.queryByTestId("river-ghost")).toBeNull();
      fireEvent.pointerUp(window, finger);
      expect(g.onCreateAt).not.toHaveBeenCalled();

      // Once a hold owns the finger, the same touchmove no longer scrolls.
      fireEvent.pointerDown(river, { ...finger, clientY: hour(12) });
      hold();
      expect(fireEvent.touchMove(river)).toBe(false);
    });

    it("a held block is carried to where its outline shows, and the release is not also a tap", () => {
      const g = gestures();
      const onEdit = vi.fn();
      renderRiver([morning, evening], false, g, onEdit);
      const river = screen.getByTestId("day-river");
      document.elementFromPoint = () => river;
      const card = screen.getByTestId(`activity-card-${morning.activityId}`);

      // Held by its middle (9:30), so its top rides half an hour above the finger.
      fireEvent.pointerDown(card, { ...finger, clientY: hour(9.5) });
      hold();
      expect(card.dataset.lifted).toBe("true");
      // The finger moves the stop, so the browser's own drag of it is refused.
      expect(canDragOf.get(card)!()).toBe(false);
      fireEvent.pointerMove(window, { ...finger, buttons: 1, clientY: hour(14.5) });
      expect(screen.getByTestId("river-ghost").textContent).toBe("2 pm – 3 pm");
      fireEvent.pointerUp(window, finger);
      fireEvent.click(block(morning.activityId).getByRole("button", { name: /^Edit Museum/ }));

      expect(g.onDropAt).toHaveBeenCalledExactlyOnceWith(morning.activityId, "day-1", { start: "14:00", end: "15:00" });
      expect(onEdit).not.toHaveBeenCalled();
      expect(screen.queryByTestId("river-ghost")).toBeNull();

      // A plain tap afterwards still opens the stop.
      fireEvent.pointerDown(card, { ...finger, clientY: hour(9.5) });
      fireEvent.pointerUp(window, finger);
      fireEvent.click(block(morning.activityId).getByRole("button", { name: /^Edit Museum/ }));
      expect(onEdit).toHaveBeenCalledExactlyOnceWith(morning.activityId);
    });

    it("the grip resizes when dragged and opens the stop when tapped, with no hold for either", () => {
      const g = gestures();
      const onEdit = vi.fn();
      renderRiver([morning, evening], false, g, onEdit);
      const grip = block(morning.activityId).getByTitle("Drag to change when it ends");

      fireEvent.pointerDown(grip, { ...finger, clientY: hour(10) });
      fireEvent.pointerMove(window, { ...finger, buttons: 1, clientY: hour(11.5) });
      fireEvent.pointerUp(window, finger);
      expect(g.onResize).toHaveBeenCalledExactlyOnceWith(morning.activityId, { start: "09:00", end: "11:30" });

      fireEvent.pointerDown(grip, { ...finger, clientY: hour(10) });
      fireEvent.pointerUp(window, finger);
      expect(onEdit).toHaveBeenCalledExactlyOnceWith(morning.activityId);
      expect(g.onResize).toHaveBeenCalledTimes(1);
    });

    // No read-only case of its own: a read-only river has no `live` gestures
    // and binds no pointer handler at all, for a finger or a mouse, which the
    // read-only test above already fails on.
  });
});
