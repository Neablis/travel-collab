import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ActivityView } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import type { DaySync } from "./context/FocusProvider";
import { chipModel, cityFor, DayChips } from "./DayChips";

afterEach(cleanup);

const day1 = "11111111-1111-4111-8111-111111111111";
const day2 = "22222222-2222-4222-8222-222222222222";
const day3 = "33333333-3333-4333-8333-333333333333";
const tokyoActivity = "44444444-4444-4444-8444-444444444444";
const osakaActivity = "55555555-5555-4555-8555-555555555555";
const noLocationActivity = "66666666-6666-4666-8666-666666666666";
const kyotoActivity = "77777777-7777-4777-8777-777777777777";

describe("chipModel", () => {
  it("emits one entry per day, with stops derived from activityIds.length", () => {
    const detail = tripDetailFixture({
      days: [
        { dayId: day1, activityIds: [tokyoActivity], date: "2027-06-01", costSubtotal: 0 },
        { dayId: day2, activityIds: [], date: "2027-06-02", costSubtotal: 0 },
      ],
      activities: {
        [tokyoActivity]: {
          activityId: tokyoActivity,
          title: "Shibuya crossing",
          timeWindow: null,
          location: { name: "Tokyo", city: "Tokyo" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      },
    });

    const chips = chipModel(detail);
    expect(chips).toHaveLength(2);
    expect(chips[0]!.stops).toBe(1);
    expect(chips[1]!.stops).toBe(0);
  });

  it("sets transitionTo only when the derived city actually changes between consecutive days", () => {
    const detail = tripDetailFixture({
      days: [
        { dayId: day1, activityIds: [tokyoActivity], date: "2027-06-01", costSubtotal: 0 },
        { dayId: day2, activityIds: [tokyoActivity], date: "2027-06-02", costSubtotal: 0 }, // same city, no transition
        { dayId: day3, activityIds: [osakaActivity], date: "2027-06-03", costSubtotal: 0 }, // city changes
      ],
      activities: {
        [tokyoActivity]: {
          activityId: tokyoActivity,
          title: "Shibuya crossing",
          timeWindow: null,
          location: { name: "Tokyo", city: "Tokyo" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
        [osakaActivity]: {
          activityId: osakaActivity,
          title: "Osaka castle",
          timeWindow: null,
          location: { name: "Osaka", city: "Osaka" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      },
    });

    const chips = chipModel(detail);
    // Day 0 has no previous day, so no transition regardless of city.
    expect(chips[0]!.transitionTo).toBeNull();
    expect(chips[0]!.transitionFrom).toBeNull();
    // Day 1's city ("Tokyo") matches day 0's ("Tokyo") — no transition.
    expect(chips[1]!.transitionTo).toBeNull();
    expect(chips[1]!.transitionFrom).toBeNull();
    // Day 2's city ("Osaka") differs from day 1's ("Tokyo") — transition fires,
    // and carries BOTH ends. transitionTo used to be set to the day's own city
    // and nothing held the other half, so every consumer that wanted to name
    // the move had to reach back into the previous chip for it.
    expect(chips[2]!.transitionTo).toBe("Osaka");
    expect(chips[2]!.transitionFrom).toBe("Tokyo");
    expect(chips[2]!.transitionFrom).not.toBe(chips[2]!.city);
  });

  it("derives city null and skips a transition when no scheduled activity has a location", () => {
    const detail = tripDetailFixture({
      days: [
        { dayId: day1, activityIds: [tokyoActivity], date: "2027-06-01", costSubtotal: 0 },
        { dayId: day2, activityIds: [noLocationActivity], date: "2027-06-02", costSubtotal: 0 },
      ],
      activities: {
        [tokyoActivity]: {
          activityId: tokyoActivity,
          title: "Shibuya crossing",
          timeWindow: null,
          location: { name: "Tokyo", city: "Tokyo" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
        [noLocationActivity]: {
          activityId: noLocationActivity,
          title: "Flight",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      },
    });

    const chips = chipModel(detail);
    expect(chips[1]!.city).toBeNull();
    // Current day's city is null, so no transition even though the previous
    // day had a real city.
    expect(chips[1]!.transitionTo).toBeNull();
  });

  // The day's city comes from its LAST located stop, so a two-city day hands
  // the NEXT day a "from" of the city it actually ended in. Under the old
  // first-stop rule this same fixture labelled the move a day late: day 2 read
  // "Tokyo" (its first stop) and the Tokyo → Kyoto arrow landed on day 3,
  // which never went anywhere.
  it("takes a travel day's transition from the previous day's LAST city", () => {
    const detail = tripDetailFixture({
      days: [
        { dayId: day1, activityIds: [tokyoActivity], date: "2027-06-01", costSubtotal: 0 },
        // Breakfast in Tokyo, then the shinkansen lands the day in Kyoto.
        { dayId: day2, activityIds: [tokyoActivity, kyotoActivity], date: "2027-06-02", costSubtotal: 0 },
        { dayId: day3, activityIds: [kyotoActivity], date: "2027-06-03", costSubtotal: 0 },
      ],
      activities: {
        [tokyoActivity]: {
          activityId: tokyoActivity,
          title: "Shibuya crossing",
          timeWindow: null,
          location: { name: "Tokyo", city: "Tokyo" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
        [kyotoActivity]: {
          activityId: kyotoActivity,
          title: "Gion at dusk",
          timeWindow: null,
          location: { name: "Kyoto", city: "Kyoto" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      },
    });

    const chips = chipModel(detail);
    expect(chips[0]!.city).toBe("Tokyo");
    // The travel day belongs to where it ends up, and carries the move.
    expect(chips[1]!.city).toBe("Kyoto");
    expect(chips[1]!.transitionFrom).toBe("Tokyo");
    expect(chips[1]!.transitionTo).toBe("Kyoto");
    // Day 3 stayed in Kyoto, so it claims no move of its own.
    expect(chips[2]!.city).toBe("Kyoto");
    expect(chips[2]!.transitionTo).toBeNull();
  });

  it("skips a stop with no location, whichever end of the day it sits at", () => {
    const detail = tripDetailFixture({
      days: [
        { dayId: day1, activityIds: [noLocationActivity, tokyoActivity], date: "2027-06-01", costSubtotal: 0 },
        { dayId: day2, activityIds: [tokyoActivity, noLocationActivity], date: "2027-06-02", costSubtotal: 0 },
      ],
      activities: {
        [noLocationActivity]: {
          activityId: noLocationActivity,
          title: "Flight",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
        [tokyoActivity]: {
          activityId: tokyoActivity,
          title: "Shibuya crossing",
          timeWindow: null,
          location: { name: "Tokyo", city: "Tokyo" },
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        },
      },
    });

    const chips = chipModel(detail);
    expect(chips[0]!.city).toBe("Tokyo");
    expect(chips[1]!.city).toBe("Tokyo");
  });

  it("falls back to a sensible label instead of crashing when date is null", () => {
    const detail = tripDetailFixture({
      days: [{ dayId: day1, activityIds: [], date: null, costSubtotal: 0 }],
    });

    const chips = chipModel(detail);
    expect(() => chipModel(detail)).not.toThrow();
    expect(chips[0]!.dow).toBe("Day 1");
    expect(chips[0]!.dateNum).toBe("");
  });
});

describe("DayChips", () => {
  // Note the shape of the old fixture this replaces: `city: "Osaka"` with
  // `transitionTo: "Osaka"`, asserting a rendered "→ Osaka" under a line-2
  // "Osaka". That was not an unrealistic fixture — chipModel really did set
  // transitionTo to the day's own city — so the duplicate city Mitchell
  // reported was pinned in place by a passing test.
  const days = [
    { dow: "Tue", dateNum: "1", city: "Tokyo", transitionFrom: null, transitionTo: null, stops: 2 },
    { dow: "Wed", dateNum: "2", city: "Osaka", transitionFrom: "Tokyo", transitionTo: "Osaka", stops: 1 },
  ];

  it("renders one chip per day", () => {
    render(<DayChips days={days} focusedDay={null} onSelect={() => {}} />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("calls onSelect with the day's index when a chip is clicked", async () => {
    const onSelect = vi.fn();
    render(<DayChips days={days} focusedDay={null} onSelect={onSelect} />);
    await userEvent.click(screen.getAllByRole("button")[1]!);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  // M16 Wave 2: `focusedDay` is the assistant's scope, so "no day selected"
  // has to be reachable from the UI and not only from a fresh page load.
  it("clears the focus when the already-focused chip is clicked again", async () => {
    const onSelect = vi.fn();
    render(<DayChips days={days} focusedDay={1} onSelect={onSelect} />);
    await userEvent.click(screen.getAllByRole("button")[1]!);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("still focuses a different day rather than clearing", async () => {
    const onSelect = vi.fn();
    render(<DayChips days={days} focusedDay={1} onSelect={onSelect} />);
    await userEvent.click(screen.getAllByRole("button")[0]!);
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  // A toggle nobody can see is a toggle nobody uses. `aria-pressed` carries it
  // for assistive tech; the × is what carries it for everyone else.
  it("marks the focused chip as pressed and shows a visible clear affordance on it", () => {
    render(<DayChips days={days} focusedDay={1} onSelect={vi.fn()} />);
    const [first, second] = screen.getAllByRole("button");
    expect(second!.getAttribute("aria-pressed")).toBe("true");
    expect(second!.textContent).toContain("×");
    expect(first!.getAttribute("aria-pressed")).toBe("false");
    expect(first!.textContent).not.toContain("×");
  });

  // Mitchell, on the PR #143 preview from a Pixel 10: "Remove the 'Remove day'
  // button on the demo trip (or any read only trip)". There is no remove-day
  // button on that screen — this × is what he was looking at, and on a trip you
  // cannot edit it reads as "delete this day" whatever it actually does.
  //
  // Both halves asserted, because dropping the affordance must not drop the
  // FUNCTION: the whole chip is the toggle, so a viewer can still deselect. A
  // fix that hid the × by disabling the chip would satisfy the first assertion
  // and break the second.
  it("drops the clear × on a read-only trip, but still lets a viewer deselect", async () => {
    const onSelect = vi.fn();
    render(<DayChips days={days} focusedDay={1} onSelect={onSelect} readOnly />);

    const [, second] = screen.getAllByRole("button");
    expect(second!.getAttribute("aria-pressed")).toBe("true");
    expect(second!.textContent).not.toContain("×");

    await userEvent.click(second!);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("always renders the transition slot element, even when there is no transition", () => {
    render(<DayChips days={days} focusedDay={null} onSelect={() => {}} />);
    const slots = screen.getAllByTestId("day-chip-transition");
    expect(slots).toHaveLength(2);
    // day[0] has transitionTo: null — the slot node still exists, just empty.
    expect(slots[0]!.textContent).toBe("");
    expect(slots[1]!.textContent).toBe("Tokyo → Osaka");
  });

  it("names both ends of the move once, not the destination twice", () => {
    render(<DayChips days={days} focusedDay={null} onSelect={() => {}} />);

    // The travel chip prints "Osaka" exactly once — in the transition line.
    // Before this, line 2 named it too, so the chip read "Osaka" / "→ Osaka".
    expect(screen.getAllByText(/Osaka/)).toHaveLength(1);
    expect(screen.getByText("Tokyo → Osaka")).toBeTruthy();
    // A day that stays put keeps its city on line 2, next to the date.
    expect(screen.getByText("Tokyo")).toBeTruthy();
  });

  it("announces the move on a travel chip's accessible name", () => {
    render(<DayChips days={days} focusedDay={null} onSelect={() => {}} />);

    expect(screen.getByRole("button", { name: "Tue, Tokyo, 2 stops" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Wed, Tokyo to Osaka, 1 stop" })).toBeTruthy();
  });

  it("shows the date number and the city as separate elements", () => {
    render(
      <DayChips
        days={[{ dow: "Sat", dateNum: "5", city: "Rochester", transitionFrom: null, transitionTo: null, stops: 2 }]}
        focusedDay={null}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText("5")).toBeTruthy();
    expect(screen.getByText("Rochester")).toBeTruthy();
  });
});

// KI-35. cityFor names the DAY — it drives the day accent and the
// "Tokyo → Nikkō" transition — so `city` stays ahead of `area` here, the
// opposite order to shortPlace(). `area` only replaces the position `name`
// used to hold: the fallback for a location with no city, where the venue
// name was standing in for a locality it isn't.
describe("cityFor", () => {
  const activityWith = (location: NonNullable<ActivityView["location"]>): ActivityView => ({
    activityId: tokyoActivity,
    title: "Dinner",
    timeWindow: null,
    location,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
  });
  const oneStopDay = { dayId: day1, activityIds: [tokyoActivity], date: "2027-06-01", costSubtotal: 0 };
  const twoStopDay = {
    dayId: day1,
    activityIds: [tokyoActivity, kyotoActivity],
    date: "2027-06-01",
    costSubtotal: 0,
  };

  // Mitchell, 2026-08-29: the day label compares "yesterday's last activity
  // city" with "today's last activity city". Where you END a day is where you
  // start the next one, which is SPEC §12's own framing — the day belongs to
  // where you end up. This used to take the FIRST city-bearing stop; on the
  // Japan fixture first and last coincide (whole days sit in one city) so no
  // fixture output moved, but a day that genuinely spans two cities is exactly
  // the case the transition label exists for, and first was wrong for it.
  it("names the day by its LAST city-bearing stop, not its first", () => {
    const activities = {
      [tokyoActivity]: activityWith({ name: "Shibuya crossing, Tokyo, Japan", city: "Tokyo" }),
      [kyotoActivity]: { ...activityWith({ name: "Gion, Kyoto, Japan", city: "Kyoto" }), activityId: kyotoActivity },
    };
    expect(cityFor(twoStopDay, activities)).toBe("Kyoto");
  });

  it("walks back past a trailing stop with no location to the last one that has a city", () => {
    const activities = {
      [tokyoActivity]: activityWith({ name: "Shibuya crossing, Tokyo, Japan", city: "Tokyo" }),
      [kyotoActivity]: {
        ...activityWith({ name: "Somewhere at sea" }),
        activityId: kyotoActivity,
        location: null,
      },
    };
    expect(cityFor(twoStopDay, activities)).toBe("Tokyo");
  });

  // The last stop names a venue and nothing structured, so it names no place
  // at all (KI-35) — the day falls back past it rather than down to `name`.
  it("walks back past a trailing venue-only stop rather than falling back to its name", () => {
    const activities = {
      [tokyoActivity]: activityWith({ name: "Shibuya crossing, Tokyo, Japan", city: "Tokyo" }),
      [kyotoActivity]: { ...activityWith({ name: "Kiyomizu-dera" }), activityId: kyotoActivity },
    };
    expect(cityFor(twoStopDay, activities)).toBe("Tokyo");
  });

  it("keeps the city ahead of the area, so a ward never splits a city's own days", () => {
    const activities = {
      [tokyoActivity]: activityWith({
        name: "Gonpachi Nishiazabu, Nishi-Azabu, Tokyo, Japan",
        city: "Tokyo",
        area: "Nishi-Azabu",
      }),
    };
    expect(cityFor(oneStopDay, activities)).toBe("Tokyo");
  });

  it("uses the area, not the venue name, when there is no city", () => {
    const activities = {
      [tokyoActivity]: activityWith({ name: "Kiyomizu-dera, Higashiyama, Japan", area: "Higashiyama" }),
    };
    expect(cityFor(oneStopDay, activities)).toBe("Higashiyama");
  });

  // Inverted when #72 merged into the #71 branch. #72 was written off a `main`
  // that predated Mitchell's rule on the #71 preview — "Never fall back to
  // name" — and asserted the venue name here. A name is not a place: this is
  // the exact path by which a restaurant came to label a whole day. No city
  // and no area means no city, and the chip says so rather than inventing one.
  it("returns null rather than the venue name when neither structured field is present", () => {
    const activities = { [tokyoActivity]: activityWith({ name: "Somewhere at sea" }) };
    expect(cityFor(oneStopDay, activities)).toBeNull();
  });
});

// "Left/Right in the days column should change the selected day in the header
// bar" (Mitchell, 2026-09-01) — the header-bar half of that, and the keyboard
// behaviour a `role="group"` of toggle buttons is expected to have anyway.
describe("DayChips keyboard navigation", () => {
  const chips = [
    { dow: "Mon", dateNum: "1", city: "Tokyo", transitionFrom: null, transitionTo: null, stops: 2 },
    { dow: "Tue", dateNum: "2", city: "Kyoto", transitionFrom: "Tokyo", transitionTo: "Kyoto", stops: 3 },
    { dow: "Wed", dateNum: "3", city: "Kyoto", transitionFrom: null, transitionTo: null, stops: 1 },
  ];

  /**
   * Renders the row and puts DOM focus on one chip.
   *
   * The handler is on the ROW, not on each chip, so that it works wherever
   * focus is inside the row — which means the test has to focus something
   * inside it for the keystroke to reach the handler at all. Focusing the row
   * element itself would not do: it is a plain `div` with no `tabIndex`, so
   * `.focus()` on it is a no-op and the keystroke lands on `<body>`.
   */
  const renderChips = (focusedDay: number | null, focusChip = 0) => {
    const onSelect = vi.fn();
    render(<DayChips days={chips} focusedDay={focusedDay} onSelect={onSelect} />);
    screen.getAllByRole("button")[focusChip]!.focus();
    return onSelect;
  };

  it("walks right and left through the days", async () => {
    const onSelect = renderChips(1, 1);

    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith(2);

    // Still from index 1: `focusedDay` is a prop here, so this render never
    // moves. That is what makes the second assertion a test of the step rule
    // rather than of state that happens to have advanced.
    await userEvent.keyboard("{ArrowLeft}");
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it("enters at the first day when nothing is selected yet", async () => {
    const onSelect = renderChips(null);
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).toHaveBeenLastCalledWith(0);
  });

  it("clamps at both ends rather than wrapping", async () => {
    // Wrapping from the last day back to the first would be a jump the length
    // of the trip; the row's own scroll does not wrap either.
    const onSelect = renderChips(2, 2);
    await userEvent.keyboard("{ArrowRight}");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("moves DOM focus with the selection", async () => {
    // A selection that walks away from the focused control leaves a screen
    // reader announcing a chip that is no longer the selected one.
    renderChips(0);
    await userEvent.keyboard("{ArrowRight}");
    // eslint-disable-next-line testing-library/no-node-access -- KI-2026-09-02-b: pre-existing, grandfathered. Do not add more.
    expect(document.activeElement).toBe(screen.getAllByRole("button")[1]);
  });

  it("leaves a modified arrow alone", async () => {
    // ⌥→ and friends are somebody's own shortcut, not a day change.
    const onSelect = renderChips(0);
    await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
    expect(onSelect).not.toHaveBeenCalled();
  });
});



// ── The day-sync contract (FocusProvider's header) ───────────────────────────
//
// The row's scroll SPY cannot be tested here — jsdom has no layout, so every
// chip rect is 0×0 and there is no reading line to sit on. That is exactly why
// the arithmetic lives in a pure module with its own tests (`centralDay.ts`)
// and the wiring is proved in a browser (`e2e/m10-growth.spec.ts`). What is
// testable in jsdom is the other half: whether the row asks to be scrolled, and
// which chip it names.

describe("DayChips day-sync", () => {
  const chips = [
    { dow: "Mon", dateNum: "1", city: "Tokyo", transitionFrom: null, transitionTo: null, stops: 2 },
    { dow: "Tue", dateNum: "2", city: "Kyoto", transitionFrom: "Tokyo", transitionTo: "Kyoto", stops: 3 },
    { dow: "Wed", dateNum: "3", city: "Kyoto", transitionFrom: null, transitionTo: null, stops: 1 },
  ];

  function stubSync(shouldFollow: boolean): { sync: DaySync; jumped: Array<Element | null | undefined> } {
    const jumped: Array<Element | null | undefined> = [];
    return {
      jumped,
      sync: {
        shouldFollow,
        pickedHere: false,
        isOwnScroll: () => false,
        reportScrolled: vi.fn(),
        jumpTo: (element) => {
          jumped.push(element);
          return true;
        },
      },
    };
  }

  // Clause 2: a day picked in a column, a calendar cell or the timeline brings
  // its chip back into view here — which is the half of Mitchell's request the
  // chips row was missing entirely.
  it("scrolls the chip for a day selected somewhere else into view", () => {
    const { sync, jumped } = stubSync(true);
    const { rerender } = render(
      <DayChips days={chips} focusedDay={null} onSelect={() => {}} sync={sync} />,
    );
    expect(jumped).toHaveLength(0);
    rerender(<DayChips days={chips} focusedDay={2} onSelect={() => {}} sync={sync} />);
    expect(jumped).toEqual([screen.getAllByRole("button")[2]]);
  });

  // Clause 1's other side: the row that produced the selection by being
  // scrolled must not then scroll itself, which is the loop the jump lock and
  // this flag exist to break.
  it("does not scroll itself back for a selection its own scrolling produced", () => {
    const { sync, jumped } = stubSync(false);
    const { rerender } = render(
      <DayChips days={chips} focusedDay={0} onSelect={() => {}} sync={sync} />,
    );
    // One jump on mount, unconditionally — clause 3, "changing the tab jumps to
    // the selected day".
    expect(jumped).toHaveLength(1);
    rerender(<DayChips days={chips} focusedDay={2} onSelect={() => {}} sync={sync} />);
    expect(jumped).toHaveLength(1);
  });

  it("renders and selects with no sync at all", async () => {
    // The prop is optional so the row stays renderable outside the provider —
    // this whole file does exactly that.
    const onSelect = vi.fn();
    render(<DayChips days={chips} focusedDay={null} onSelect={onSelect} />);
    await userEvent.click(screen.getAllByRole("button")[1]!);
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});
