import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { DAYTIME_END_MINUTES, DAYTIME_START_MINUTES, findFreeGaps, summarizeFreeDays } from "../src";
import { witness } from "./support/witness";

const hhmm = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

// A window inside one day, in quarter hours, or null for an untimed stop.
const windowArb = fc.option(
  fc.tuple(fc.integer({ min: 0, max: 94 }), fc.integer({ min: 1, max: 24 })).map(([start, length]) => ({
    start: hhmm(start * 15),
    end: hhmm(Math.min(start + length, 95) * 15),
  })),
  { nil: null },
);

function tripOf(days: Array<Array<{ start: string; end: string } | null>>): TripDetail {
  const activities: TripDetail["activities"] = {};
  const dayRows = days.map((windows, d) => {
    const activityIds = windows.map((timeWindow, i) => {
      const id = `d${d}a${i}`;
      activities[id] = {
        activityId: id, title: id, timeWindow, location: null, notes: null, anchors: [], kind: "planned",
        tags: [], cost: null, bookedBy: null, participants: [], mode: null, endLocation: null, pendingReason: null,
      };
      return id;
    });
    return { dayId: `day${d}`, activityIds, date: null, costSubtotal: 0 };
  });
  return {
    tripId: "1c2d3e4f-0000-4000-8000-000000000032", name: "Property", status: "active", startDate: null,
    currency: "USD", budget: null, members: [{ userId: "u1", role: "owner" }], forkedFrom: null, days: dayRows,
    backlog: [], activities, conflicts: [], dismissedConflictIds: [], createdAt: "2026-10-04T00:00:00.000Z",
    unscheduledCostSubtotal: 0, tripCostTotal: 0, budgetRemaining: null,
  } as TripDetail;
}

const daytime = { afterMinutes: DAYTIME_START_MINUTES, beforeMinutes: DAYTIME_END_MINUTES };

describe("summarizeFreeDays (property)", () => {
  // The decision M32 rests on: a day's total is the sum of the gaps the same
  // call lists, so a ranking can never disagree with the gaps beside it.
  it("a day's free minutes are its gaps' sum, within the window, split exactly by the parts", () => {
    const w = witness("free day = sum of its gaps");
    fc.assert(
      fc.property(fc.array(fc.array(windowArb, { maxLength: 6 }), { minLength: 1, maxLength: 6 }), (days) => {
        const trip = tripOf(days);
        const gaps = findFreeGaps(trip, daytime);
        const rows = summarizeFreeDays(trip, daytime);
        expect(rows).toHaveLength(days.length);
        for (const row of rows) {
          const own = gaps.filter((gap) => gap.dayIndex === row.dayIndex);
          expect(row.freeMinutes).toBe(own.reduce((sum, gap) => sum + gap.durationMinutes, 0));
          expect(row.freeMinutes).toBeLessThanOrEqual(DAYTIME_END_MINUTES - DAYTIME_START_MINUTES);
          // Inside 08:00-22:00 the three parts tile the window, so they sum to the total.
          expect(row.parts.morning + row.parts.afternoon + row.parts.evening).toBe(row.freeMinutes);
          w.tick();
        }
      }),
    );
    w.atLeast(165); // measured 334-364 over 10 runs (2026-10-04); half the minimum
  });

  it("ranks most free first", () => {
    const w = witness("ranked most free first");
    fc.assert(
      fc.property(fc.array(fc.array(windowArb, { maxLength: 6 }), { minLength: 2, maxLength: 6 }), (days) => {
        const rows = summarizeFreeDays(tripOf(days), daytime);
        for (let i = 1; i < rows.length; i += 1) {
          expect(rows[i - 1]!.freeMinutes).toBeGreaterThanOrEqual(rows[i]!.freeMinutes);
          w.tick();
        }
      }),
    );
    w.atLeast(130); // measured 262-323 over 10 runs (2026-10-04); half the minimum
  });
});
