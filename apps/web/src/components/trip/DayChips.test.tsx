import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { chipModel, DayChips } from "./DayChips";

afterEach(cleanup);

const day1 = "11111111-1111-4111-8111-111111111111";
const day2 = "22222222-2222-4222-8222-222222222222";
const day3 = "33333333-3333-4333-8333-333333333333";
const tokyoActivity = "44444444-4444-4444-8444-444444444444";
const osakaActivity = "55555555-5555-4555-8555-555555555555";
const noLocationActivity = "66666666-6666-4666-8666-666666666666";

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
          location: { name: "Tokyo" },
          notes: null,
          anchors: [],
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
          location: { name: "Tokyo" },
          notes: null,
          anchors: [],
          cost: null,
        },
        [osakaActivity]: {
          activityId: osakaActivity,
          title: "Osaka castle",
          timeWindow: null,
          location: { name: "Osaka" },
          notes: null,
          anchors: [],
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
          location: { name: "Tokyo" },
          notes: null,
          anchors: [],
          cost: null,
        },
        [noLocationActivity]: {
          activityId: noLocationActivity,
          title: "Flight",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [],
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

  it("falls through to a later activity's location when an earlier one has none", () => {
    const detail = tripDetailFixture({
      days: [{ dayId: day1, activityIds: [noLocationActivity, tokyoActivity], date: "2027-06-01", costSubtotal: 0 }],
      activities: {
        [noLocationActivity]: {
          activityId: noLocationActivity,
          title: "Flight",
          timeWindow: null,
          location: null,
          notes: null,
          anchors: [],
          cost: null,
        },
        [tokyoActivity]: {
          activityId: tokyoActivity,
          title: "Shibuya crossing",
          timeWindow: null,
          location: { name: "Tokyo" },
          notes: null,
          anchors: [],
          cost: null,
        },
      },
    });

    expect(chipModel(detail)[0]!.city).toBe("Tokyo");
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
