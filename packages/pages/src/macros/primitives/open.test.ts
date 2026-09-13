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
          // `time-overlap`, which is what `detectConflicts` actually emits.
          // This fixture said `"overlap"` — a kind the domain has never
          // produced — and passed, because every conflict was labelled
          // "Overlap" regardless (CodeRabbit, PR 170).
          { id: "c1", kind: "time-overlap", severity: "warn", subjects: ["a1"], description: "Two stops at 09:00", resolutions: [] },
        ],
        backlog: ["a2"],
        activities: { a2: idea("Ghibli Museum") } as unknown as TripDetail["activities"],
      }),
    );
    expect(leads(result)).toEqual(["Overlap", "Empty day", "Parked"]);
    expect(texts(result)).toEqual(["Two stops at 09:00", "Day 2", "Ghibli Museum"]);
  });

  it("names each kind of conflict for what it is, not all of them 'Overlap'", () => {
    // **Every row said "Overlap"**, which was true of one of the four kinds
    // `packages/domain/src/trip/conflicts.ts` emits and a lie about the other
    // three: an impossible journey, a broken anchor and a trip over budget were
    // all announced as overlaps, with a correct description sitting beside the
    // wrong label (CodeRabbit, PR 170).
    //
    // The kinds are listed here rather than imported: `Conflict.kind` is
    // `z.string()` in the contract, and this package may not import
    // `@tc/domain`. So this is a transcription, and the fallback below is what
    // makes a missed one degrade instead of lie.
    const conflictOf = (kind: string, id: string) => ({
      id, kind, severity: "warn" as const, subjects: ["a1"], description: `${kind} happened`, resolutions: [],
    });
    const result = resolve(
      tripWith({
        days: [dayWith(["a1"])],
        conflicts: [
          conflictOf("time-overlap", "c1"),
          conflictOf("impossible-geography", "c2"),
          conflictOf("anchor-violation", "c3"),
          conflictOf("over-budget", "c4"),
        ],
      }),
    );
    expect(leads(result)).toEqual(["Overlap", "Too far", "Anchor", "Over budget"]);
  });

  it("calls an unknown kind a conflict rather than printing its stored name", () => {
    // A kind the domain adds later. "Conflict" is true of anything, and the
    // description beside it already says what happened — where printing the raw
    // `kind` would put a stored identifier on a page somebody reads.
    const result = resolve(
      tripWith({
        days: [dayWith(["a1"])],
        conflicts: [
          { id: "c9", kind: "something-new", severity: "warn", subjects: ["a1"], description: "Something new", resolutions: [] },
        ],
      }),
    );
    expect(leads(result)).toEqual(["Conflict"]);
    expect(texts(result)).toEqual(["Something new"]);
  });

  it("drops a dismissed conflict, because dismissing it WAS the decision", () => {
    // Asking twice about something already answered is the failure this guards:
    // the board filters the same set the same way, and an Overview that
    // disagrees with Plan is worse than no Overview (§25).
    const conflict = { id: "c1", kind: "time-overlap", severity: "warn" as const, subjects: ["a1"], description: "Two stops at 09:00", resolutions: [] };
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
