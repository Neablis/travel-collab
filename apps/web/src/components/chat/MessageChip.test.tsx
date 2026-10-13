import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityFactory, costedTripDetailFixture, tripDetailFixture, uuidFrom } from "@tc/factories";
import { tripTargets } from "@/components/palette/commands";
import { registerBoardFocus } from "./boardFocus";
import { MessageBody } from "./MessageChip";

const DAY = uuidFrom(1, 46);
const colosseum = activityFactory.build({ activityId: uuidFrom(2, 46), title: "Colosseum", timeWindow: { start: "09:00", end: "11:00" } });
const trip = tripDetailFixture({
  tripId: uuidFrom(0, 46),
  days: [{ dayId: DAY, activityIds: [colosseum.activityId], date: null, costSubtotal: 0 }],
  activities: { [colosseum.activityId]: colosseum },
});
// Another trip, with a stop of the same name: its id must find nothing here.
const elsewhere = costedTripDetailFixture();
const theirColosseum = elsewhere.days[0]!.activityIds[0]!;

const focusDay = vi.fn();
const focusActivity = vi.fn();
let unregister = () => {};
const boardOf = (detail: typeof trip) => ({ ...tripTargets(detail, { focusedActivityId: null, focusedDayId: null, selectedDayId: null }), focusDay, focusActivity });
const onThisBoard = () => {
  act(() => {
    unregister = registerBoardFocus(boardOf(trip));
  });
};

afterEach(() => {
  act(() => unregister());
  vi.clearAllMocks();
});

describe("a message's day or stop link (M46 D3)", () => {
  it("is a chip for this trip's stop, in place of its mention, and focuses it on the board", () => {
    onThisBoard();
    render(<MessageBody body="Meet at @Colosseum?" link={{ kind: "stop", id: colosseum.activityId }} />);
    fireEvent.click(screen.getByRole("button", { name: "@Colosseum" }));
    expect(focusActivity).toHaveBeenCalledWith(colosseum.activityId);
  });

  it("is a chip for this trip's day, named as the board names it", () => {
    onThisBoard();
    render(<MessageBody body="Free @Day 1" link={{ kind: "day", id: DAY }} />);
    fireEvent.click(screen.getByRole("button", { name: "@Day 1" }));
    expect(focusDay).toHaveBeenCalledWith(DAY);
  });

  // The link is an id the message carries: one from another trip, pasted or
  // crafted, is looked up only among this board's days and stops, so it is
  // the words as written and never a way to that trip. That trip's board was
  // registered first, as the one the reader came from, so a lookup reaching
  // past this board would find the stop.
  it("is plain text for another trip's stop, and focuses nothing", () => {
    expect(elsewhere.tripId).not.toBe(trip.tripId);
    act(() => {
      registerBoardFocus(boardOf(elsewhere));
    });
    onThisBoard();
    render(<MessageBody body="Meet at @Colosseum?" link={{ kind: "stop", id: theirColosseum }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Meet at @Colosseum?")).toBeTruthy();
    expect(focusActivity).not.toHaveBeenCalled();
  });

  // PR 439 review: `@Day 1` is also the start of `@Day 10`, typed by hand.
  it("is a chip in place of its whole mention, not the start of a longer one", () => {
    onThisBoard();
    render(<MessageBody body="Swap @Day 10 for @Day 1" link={{ kind: "day", id: DAY }} />);
    expect(screen.getByRole("button", { name: "@Day 1" })).toBeTruthy();
    // The words around the chip, without it: all of `@Day 10` is left as typed.
    expect(screen.getByText("Swap @Day 10 for")).toBeTruthy();
  });

  // A stop deleted since: the message keeps its words, the chip goes.
  it("is plain text once its target is gone, or with no board to focus", () => {
    render(<MessageBody body="Meet at @Colosseum?" link={{ kind: "stop", id: colosseum.activityId }} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Meet at @Colosseum?")).toBeTruthy();
  });
});
