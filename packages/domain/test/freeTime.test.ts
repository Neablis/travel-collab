import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { findFreeGaps } from "../src";

const TRIP = "1c2d3e4f-0000-4000-8000-000000000001";
const MEMBER = { userId: "u1", role: "owner" as const };

// Minimal ActivityView; only timeWindow varies per test.
function activity(id: string, timeWindow: { start: string; end: string } | null) {
  return {
    activityId: id,
    title: id,
    timeWindow,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned" as const,
    tags: [],
    cost: null,
  };
}

function day(dayId: string, activityIds: string[]) {
  return { dayId, activityIds, date: null, costSubtotal: 0 };
}

// Builds a TripDetail from a list of days (each an array of activityIds) and
// the activities record backing them. `activities` is a Record<string, ReturnType<typeof activity>>
// but a caller may omit an id from it on purpose (the "dangling id" test).
function detail(
  days: ReturnType<typeof day>[],
  activities: Record<string, ReturnType<typeof activity>>,
): TripDetail {
  return {
    tripId: TRIP,
    name: "Test Trip",
    status: "active",
    startDate: null,
    currency: "USD",
    budget: null,
    members: [MEMBER],
    forkedFrom: null,
    days,
    backlog: [],
    activities,
    conflicts: [],
    dismissedConflictIds: [],
    createdAt: "2026-08-29T00:00:00.000Z",
    unscheduledCostSubtotal: 0,
    tripCostTotal: 0,
    budgetRemaining: null,
  };
}

describe("findFreeGaps", () => {
  it("an untimed activity does not occupy time, close, or shrink a gap", () => {
    const d = detail([day("d1", ["a1"])], { a1: activity("a1", null) });
    expect(findFreeGaps(d)).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 1440, durationMinutes: 1440 },
    ]);
  });

  it("overlapping activities merge into one busy block, never a negative gap", () => {
    const d = detail([day("d1", ["a1", "a2"])], {
      a1: activity("a1", { start: "09:00", end: "11:00" }),
      a2: activity("a2", { start: "10:00", end: "12:00" }), // overlaps a1 by 60min
    });
    const gaps = findFreeGaps(d);
    // One merged busy block 09:00-12:00 (540-720) leaves exactly two gaps,
    // not three, and no gap has a negative duration.
    expect(gaps).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 540, durationMinutes: 540 },
      { dayIndex: 0, startMinutes: 720, endMinutes: 1440, durationMinutes: 720 },
    ]);
    expect(gaps.every((g) => g.durationMinutes > 0)).toBe(true);
  });

  it("full-containment overlap merges to the containing block, not the inner one", () => {
    // B (10:00-11:00) is entirely inside A (09:00-17:00). A naive merge that
    // overwrites the block's end with the later-processed activity's end
    // (`last[1] = block[1]`) rather than taking the max would truncate the
    // merged block to 11:00, turning 11:00-17:00 into phantom free time.
    const d = detail([day("d1", ["a1", "a2"])], {
      a1: activity("a1", { start: "09:00", end: "17:00" }),
      a2: activity("a2", { start: "10:00", end: "11:00" }),
    });
    expect(findFreeGaps(d)).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 540, durationMinutes: 540 },
      { dayIndex: 0, startMinutes: 1020, endMinutes: 1440, durationMinutes: 420 },
    ]);
  });

  it("a day with no timed activities is one gap spanning the whole window", () => {
    const d = detail([day("d1", ["a1"])], { a1: activity("a1", null) });
    expect(findFreeGaps(d, { dayIndex: 0 })).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 1440, durationMinutes: 1440 },
    ]);
  });

  it("a day with no activities at all is likewise one full-window gap", () => {
    const d = detail([day("d1", [])], {});
    expect(findFreeGaps(d)).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 1440, durationMinutes: 1440 },
    ]);
  });

  it("a dangling activityId with no matching record does not crash and does not occupy time", () => {
    const d = detail([day("d1", ["ghost"])], {});
    expect(findFreeGaps(d)).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 1440, durationMinutes: 1440 },
    ]);
  });

  it("gaps are sorted by dayIndex then startMinutes, a stable order for ties", () => {
    const d = detail(
      [
        day("d1", ["a1"]), // dayIndex 0: gap after 09:00 -> starts at 540
        day("d2", ["b1"]), // dayIndex 1: gap after 10:00 -> starts at 600
      ],
      {
        a1: activity("a1", { start: "00:00", end: "09:00" }),
        b1: activity("b1", { start: "00:00", end: "10:00" }),
      },
    );
    const gaps = findFreeGaps(d);
    expect(gaps.map((g) => [g.dayIndex, g.startMinutes])).toEqual([
      [0, 540],
      [1, 600],
    ]);
  });

  it("gaps on the same day are sorted by startMinutes (the tiebreaker actually fires)", () => {
    // One activity in the middle of the day produces two gaps at the same
    // dayIndex; asserts they come back in start order, not creation order.
    const d = detail([day("d1", ["a1"])], {
      a1: activity("a1", { start: "12:00", end: "13:00" }),
    });
    const gaps = findFreeGaps(d);
    expect(gaps.map((g) => g.startMinutes)).toEqual([0, 780]);
  });

  it("afterMinutes/beforeMinutes clip a full-free day rather than filtering it", () => {
    const d = detail([day("d1", [])], {});
    expect(findFreeGaps(d, { afterMinutes: 1200 })).toEqual([
      { dayIndex: 0, startMinutes: 1200, endMinutes: 1440, durationMinutes: 240 },
    ]);
  });

  it("an activity extending past beforeMinutes clips rather than vanishing", () => {
    // Activity 08:00-12:00 (480-720) extends past beforeMinutes=600 (10:00).
    // A buggy implementation that drops (rather than clips) any activity
    // crossing the boundary would report the whole 0-600 window as free;
    // the correct answer stops the gap where the activity starts.
    const d = detail([day("d1", ["a1"])], {
      a1: activity("a1", { start: "08:00", end: "12:00" }),
    });
    expect(findFreeGaps(d, { beforeMinutes: 600 })).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 480, durationMinutes: 480 },
    ]);
  });

  it("minMinutes is applied after clipping, not before", () => {
    // Unclipped, the free day's gap is 1440min (>= minMinutes). Clipped to
    // [1400, 1440) it is only 40min, which minMinutes=100 must drop.
    const d = detail([day("d1", [])], {});
    expect(findFreeGaps(d, { afterMinutes: 1400, minMinutes: 100 })).toEqual([]);
  });

  it("zero-length gaps are never returned", () => {
    // Back-to-back activities with no space between them (10:00 end == 10:00 start).
    const d = detail([day("d1", ["a1", "a2"])], {
      a1: activity("a1", { start: "09:00", end: "10:00" }),
      a2: activity("a2", { start: "10:00", end: "11:00" }),
    });
    const gaps = findFreeGaps(d);
    expect(gaps.some((g) => g.durationMinutes === 0)).toBe(false);
    expect(gaps).toEqual([
      { dayIndex: 0, startMinutes: 0, endMinutes: 540, durationMinutes: 540 },
      { dayIndex: 0, startMinutes: 660, endMinutes: 1440, durationMinutes: 780 },
    ]);
  });

  it("invalid input (afterMinutes >= beforeMinutes) returns [] rather than throwing", () => {
    const d = detail([day("d1", [])], {});
    expect(findFreeGaps(d, { afterMinutes: 800, beforeMinutes: 800 })).toEqual([]);
    expect(findFreeGaps(d, { afterMinutes: 900, beforeMinutes: 800 })).toEqual([]);
  });
});
