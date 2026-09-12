import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { open } from "./open";
import type { RepeatPayload, WidgetContext } from "../../registry-types";
import type { MacroResult } from "../../result";

const TRIP_ID = "11111111-1111-1111-1111-111111111111";

function tripWith(patch: Partial<TripDetail>): TripDetail {
  return {
    tripId: TRIP_ID, name: "T", status: "active", startDate: "2026-08-01", currency: "USD",
    budget: null, members: [{ userId: "u1", role: "owner" }], forkedFrom: null,
    days: [], backlog: [], activities: {}, conflicts: [], dismissedConflictIds: [],
    createdAt: "2026-07-20T00:00:00.000Z", unscheduledCostSubtotal: 0, tripCostTotal: 0,
    budgetRemaining: null,
    ...patch,
  } as TripDetail;
}

const resolve = (trip: TripDetail): MacroResult<RepeatPayload> =>
  open.resolve({ trip, page: { tripId: TRIP_ID }, user: null, globals: null } as unknown as WidgetContext, {});

/** The lead label of every row, in order — what the reader actually sees down the left. */
function leads(result: MacroResult<RepeatPayload>): string[] {
  if (result.status !== "ok") return [];
  return result.value.rows.map((r) => r.lead.text);
}

function texts(result: MacroResult<RepeatPayload>): string[] {
  if (result.status !== "ok") return [];
  return result.value.rows.flatMap((r) => r.cells.flat().map((v) => v.text));
}

const dayWith = (activityIds: string[]) => ({ dayId: "d", activityIds, date: null, costSubtotal: 0 });
const idea = (title: string) => ({
  activityId: "a", tripId: TRIP_ID, title, dayId: null, position: 0,
  timeWindow: null, location: null, cost: null, notes: null, kind: "idea", tags: [],
});

describe("`open` — what needs you (SPEC §25)", () => {
  it("says a settled trip is settled, rather than listing nothing", () => {
    // The empty state is the GOOD one here: a trip with a full day, no
    // conflicts and an empty rack has nothing waiting on anyone.
    const result = resolve(tripWith({ days: [dayWith(["a1"])] }));
    expect(result.status).toBe("empty");
  });

  it("lists an overlap, an empty day and a parked idea — one row each", () => {
    const result = resolve(
      tripWith({
        days: [dayWith(["a1"]), dayWith([])],
        conflicts: [
          { id: "c1", kind: "overlap", severity: "warn", subjects: ["a1"], description: "Two stops at 09:00", resolutions: [] },
        ],
        backlog: ["a2"],
        activities: { a2: idea("Ghibli Museum") } as unknown as TripDetail["activities"],
      }),
    );
    expect(leads(result)).toEqual(["Overlap", "Empty day", "Parked"]);
    expect(texts(result)).toEqual(["Two stops at 09:00", "Day 2", "Ghibli Museum"]);
  });

  it("drops a dismissed conflict, because dismissing it WAS the decision", () => {
    // Asking twice about something already answered is the failure this guards:
    // the board filters the same set the same way, and an Overview that
    // disagrees with Plan is worse than no Overview (§25).
    const conflict = { id: "c1", kind: "overlap", severity: "warn" as const, subjects: ["a1"], description: "Two stops at 09:00", resolutions: [] };
    const days = [dayWith(["a1"])];
    expect(leads(resolve(tripWith({ days, conflicts: [conflict] })))).toEqual(["Overlap"]);
    expect(resolve(tripWith({ days, conflicts: [conflict], dismissedConflictIds: ["c1"] })).status).toBe("empty");
  });

  it("skips a backlog id with no activity behind it rather than drawing a blank row", () => {
    // The two fields are one projection and can only disagree mid-write. One
    // fewer row is right; an empty row is not.
    const result = resolve(tripWith({ days: [dayWith(["a1"])], backlog: ["ghost"] }));
    expect(result.status).toBe("empty");
  });

  it("numbers an empty day by its position in the trip, not by its id", () => {
    const result = resolve(tripWith({ days: [dayWith(["a1"]), dayWith(["a1"]), dayWith([])] }));
    expect(texts(result)).toEqual(["Day 3"]);
  });
});
