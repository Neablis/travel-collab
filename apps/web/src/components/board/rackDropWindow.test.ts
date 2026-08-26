import { describe, expect, it } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import type { ActivityView, TripDetail } from "@tc/contracts";
import { rackDropWindow } from "./rackDropWindow";

const DAY = "11111111-1111-4111-8111-111111111111";
const PARKED = "22222222-2222-4222-8222-222222222222";
const MORNING = "33333333-3333-4333-8333-333333333333";
const AFTERNOON = "44444444-4444-4444-8444-444444444444";
const UNTIMED = "55555555-5555-4555-8555-555555555555";
const PARKED_WITH_TIME = "66666666-6666-4666-8666-666666666666";

function activity(activityId: string, timeWindow: { start: string; end: string } | null): ActivityView {
  return { activityId, title: activityId, timeWindow, location: null, notes: null, anchors: [], cost: null };
}

/** A day holding `dayActivityIds`, with `backlogIds` parked off the schedule. */
function trip(dayActivityIds: string[], backlogIds: string[]): TripDetail {
  return tripDetailFixture({
    days: [{ dayId: DAY, activityIds: dayActivityIds, date: "2027-06-01", costSubtotal: 0 }],
    backlog: backlogIds,
    activities: {
      [PARKED]: activity(PARKED, null),
      [MORNING]: activity(MORNING, { start: "09:00", end: "10:00" }),
      [AFTERNOON]: activity(AFTERNOON, { start: "15:00", end: "16:00" }),
      [UNTIMED]: activity(UNTIMED, null),
      [PARKED_WITH_TIME]: activity(PARKED_WITH_TIME, { start: "10:00", end: "12:00" }),
    },
  });
}

describe("rackDropWindow", () => {
  it("times a stop dropped from the rack, starting after the stop above it", () => {
    // 09:00–10:00 sits above; fitIntoDay owes 30 minutes of air where a stop
    // butts up against the window before it, so the first hour it can offer
    // begins at 10:30.
    expect(rackDropWindow(trip([MORNING], [PARKED]), PARKED, DAY, 1)).toEqual({ start: "10:30", end: "11:30" });
  });

  it("lands in the free morning when dropped above a lone afternoon booking", () => {
    // The case that made "no stop above it" and "no preference" different
    // things. Passing no preference makes fitIntoDay search forward from the
    // day's LAST window, which returned 16:30 here — later than the 15:00 stop
    // it was dropped ABOVE. Asking for the day's start puts it where the drop
    // said it should go.
    expect(rackDropWindow(trip([AFTERNOON], [PARKED]), PARKED, DAY, 0)).toEqual({ start: "09:00", end: "10:00" });
  });

  it("still moves forward when the top of the day has no room before the first stop", () => {
    // Dropped above a 09:00–10:00 stop: there is no earlier slot the day is
    // willing to offer, so it takes the next one rather than inventing a
    // pre-dawn window.
    expect(rackDropWindow(trip([MORNING], [PARKED]), PARKED, DAY, 0)).toEqual({ start: "10:30", end: "11:30" });
  });

  it("uses the day's own default on an empty day", () => {
    expect(rackDropWindow(trip([], [PARKED]), PARKED, DAY, 0)).toEqual({ start: "09:00", end: "10:00" });
  });

  it("finds a gap that fits rather than overlapping the stop below it", () => {
    // Dropped between 09:00–10:00 and 15:00–16:00. It must land inside that
    // gap, not on top of either neighbour.
    const window = rackDropWindow(trip([MORNING, AFTERNOON], [PARKED]), PARKED, DAY, 1);

    expect(window).not.toBeNull();
    expect(window!.start >= "10:00").toBe(true);
    expect(window!.end <= "15:00").toBe(true);
  });

  // The bug this function was extracted for (CodeRabbit, PR #55). The first
  // version asked "does this stop have a time yet?" as a proxy for "did it come
  // off the rack" — but an untimed stop can already be sitting on a day, and
  // Board routes a same-day reorder through the very same callback.
  it("leaves an untimed stop already on the day alone when it is only reordered", () => {
    const before = trip([MORNING, UNTIMED], []);

    // Reordering UNTIMED to the top of its own day. It has no timeWindow, so
    // the old timeWindow-based gate would have handed it 09:00–10:00 here —
    // changing more than the order the user dragged.
    expect(rackDropWindow(before, UNTIMED, DAY, 0)).toBeNull();
    expect(rackDropWindow(before, UNTIMED, DAY, 1)).toBeNull();
  });

  // The regression CI caught and the unit tests here did not, because every
  // rack fixture was untimed. A stop can be CREATED unscheduled with a real
  // time and parked — only unscheduling strips a window — so rack membership
  // alone is not permission to overwrite one. m1-board's whole overlap
  // scenario is this: two rack stops at 09:00–11:00 and 10:00–12:00 dragged
  // onto one day to collide. Fitting them politely into free gaps pulled them
  // apart and the conflict never formed.
  it("keeps the time a parked stop already had, rather than fitting it into a gap", () => {
    const parkedWithATime = trip([MORNING], [PARKED_WITH_TIME]);

    expect(rackDropWindow(parkedWithATime, PARKED_WITH_TIME, DAY, 1)).toBeNull();
    // Including when honouring it means overlapping what is already there —
    // an overlap the user built on purpose is data, not something to design
    // away behind their back (AGENTS.md invariant 3).
    expect(rackDropWindow(parkedWithATime, PARKED_WITH_TIME, DAY, 0)).toBeNull();
  });

  it("leaves a timed stop's window alone when it is only reordered", () => {
    // A 15:00 booking dragged up one place must not silently reschedule.
    expect(rackDropWindow(trip([MORNING, AFTERNOON], []), AFTERNOON, DAY, 0)).toBeNull();
  });

  it("assigns nothing when the drop is onto the rack itself", () => {
    // toDayId null is an unschedule, which strips times by its own path.
    expect(rackDropWindow(trip([MORNING], [PARKED]), PARKED, null, 0)).toBeNull();
  });

  it("assigns nothing when the destination day is not in the trip", () => {
    expect(rackDropWindow(trip([MORNING], [PARKED]), PARKED, "not-a-day", 0)).toBeNull();
  });

  it("reads the backlog as it was before the move, which is the caller's contract", () => {
    // Spelled out as a test because getting it wrong is silent: MoveActivity is
    // applied optimistically, so a caller that passed post-move state would see
    // an empty backlog and never time anything.
    const afterTheMoveWasApplied = trip([MORNING, PARKED], []);
    expect(rackDropWindow(afterTheMoveWasApplied, PARKED, DAY, 1)).toBeNull();

    const beforeTheMove = trip([MORNING], [PARKED]);
    expect(rackDropWindow(beforeTheMove, PARKED, DAY, 1)).not.toBeNull();
  });
});
