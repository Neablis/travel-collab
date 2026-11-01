import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { open } from "./open";
import type { ItemsPayload, WidgetContext } from "../../registry-types";
import type { MacroResult } from "../../result";
import { renderMacro } from "../../registry";

const TRIP_ID = "11111111-1111-1111-1111-111111111111";
const DAY_1 = "22222222-2222-2222-2222-222222222221";
const DAY_2 = "22222222-2222-2222-2222-222222222222";
const DAY_3 = "22222222-2222-2222-2222-222222222223";

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

const resolve = (trip: TripDetail, params: Record<string, unknown> = {}): MacroResult<ItemsPayload> =>
  open.resolve({ trip, page: { tripId: TRIP_ID }, user: null, globals: null } as unknown as WidgetContext, params);

/** Every item, in order — what the reader sees down the list. */
function items(result: MacroResult<ItemsPayload>): ItemsPayload["items"] {
  if (result.status !== "ok") return [];
  return result.value.items;
}
const labels = (result: MacroResult<ItemsPayload>) => items(result).map((item) => item.label);

const dayWith = (dayId: string, activityIds: string[], date: string | null = null) =>
  ({ dayId, activityIds, date, costSubtotal: 0 });
const stop = (title: string, city?: string) => ({
  activityId: "a", tripId: TRIP_ID, title, dayId: null, position: 0,
  timeWindow: null, location: city === undefined ? null : { name: title, city }, cost: null, notes: null, kind: "planned", tags: [],
});
const conflictOf = (kind: string, id: string, subjects = ["a1"]) => ({
  id, kind, severity: "warn" as const, subjects, description: `${kind} happened`, resolutions: [],
});

describe("`open` — what needs you (SPEC §25, M43 decision 4)", () => {
  it("says a settled trip is settled, rather than listing nothing", () => {
    // The empty state is the GOOD one here: a trip with a full day, no
    // conflicts and an empty rack has nothing waiting on anyone. No
    // `because`: that is what lets `MacroView` draw the success line, which a
    // filtered empty must not get.
    const result = resolve(tripWith({ days: [dayWith(DAY_1, ["a1"])] }));
    expect(result).toEqual({ status: "empty" });
  });

  it("draws the design's three rows — a conflict, an empty day and the parked ideas — each with its way to fix it", () => {
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1", "a3"], "2026-08-01"), dayWith(DAY_2, [], "2026-08-02")],
        conflicts: [conflictOf("time-overlap", "c1", ["a1", "a3"])],
        backlog: ["a2"],
        activities: {
          a1: stop("Breakfast", "Kyoto"), a3: stop("Shrine", "Kyoto"), a2: stop("Ghibli Museum"),
        } as unknown as TripDetail["activities"],
      }),
    );
    expect(items(result)).toEqual([
      {
        label: "Overlap on Day 1", sub: "Aug 1 · Kyoto", right: "Fix in Plan", tone: "warning",
        act: { kind: "day", day: { kind: "dayId", dayId: DAY_1 } },
      },
      {
        label: "Day 2 has nothing on it", sub: "Aug 2", right: "Plan it", tone: "info",
        act: { kind: "day", day: { kind: "dayId", dayId: DAY_2 } },
      },
      {
        label: "1 idea is parked", sub: "Ghibli Museum", right: "Place them", tone: "plain",
        // The rack, not plain Plan: the design's act is `blOpen: true`, and
        // Plan alone lands with the rack shut and the ideas off screen.
        act: { kind: "rack" },
      },
    ]);
  });

  it("groups every parked idea into ONE row, naming the first two", () => {
    // The design's rack row: one row per idea buried the conflicts under the
    // backlog on a trip with twenty saved places.
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1"])],
        backlog: ["p1", "p2", "p3"],
        activities: { p1: stop("Ghibli Museum"), p2: stop("Golden Gai"), p3: stop("Onsen") } as unknown as TripDetail["activities"],
      }),
    );
    expect(items(result).map(({ label, sub }) => ({ label, sub }))).toEqual([
      { label: "3 ideas are parked", sub: "Ghibli Museum · Golden Gai" },
    ]);
  });

  it("names each kind of conflict for what it is, not all of them 'Overlap'", () => {
    // **Every row said "Overlap"**, which was true of one of the four kinds
    // `packages/domain/src/trip/conflicts.ts` emits and a lie about the other
    // three (CodeRabbit, PR 170). The kinds are listed here rather than
    // imported: `Conflict.kind` is `z.string()` in the contract, and this
    // package may not import `@tc/domain`.
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1"])],
        conflicts: [
          conflictOf("time-overlap", "c1"),
          conflictOf("impossible-geography", "c2"),
          conflictOf("anchor-violation", "c3"),
          conflictOf("over-budget", "c4", [TRIP_ID]),
        ],
      }),
    );
    expect(labels(result)).toEqual(["Overlap on Day 1", "Too far on Day 1", "Anchor on Day 1", "Over budget"]);
  });

  it("puts a conflict on the day that holds its stops, not on the first day", () => {
    // Every other fixture here is on Day 1, so index 0 hard-coded passed them
    // all while a Day 2 overlap read "on Day 1" and linked there.
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1"]), dayWith(DAY_2, ["a2", "a3"], "2026-08-02")],
        conflicts: [conflictOf("time-overlap", "c1", ["a2", "a3"])],
        activities: { a2: stop("Market", "Osaka"), a3: stop("Castle", "Osaka") } as unknown as TripDetail["activities"],
      }),
    );
    expect(items(result)).toEqual([
      {
        label: "Overlap on Day 2", sub: "Aug 2 · Osaka", right: "Fix in Plan", tone: "warning",
        act: { kind: "day", day: { kind: "dayId", dayId: DAY_2 } },
      },
    ]);
  });

  it("sends a conflict on no day to the Plan, saying what happened", () => {
    // Over budget names the trip, not a stop, so there is no day for it to be
    // "on" and no date or city for the line under it: the domain's own
    // sentence goes there instead.
    const result = resolve(tripWith({ days: [dayWith(DAY_1, ["a1"])], conflicts: [conflictOf("over-budget", "c4", [TRIP_ID])] }));
    expect(items(result)).toEqual([
      { label: "Over budget", sub: "over-budget happened", right: "Fix in Plan", tone: "warning", act: { kind: "view", view: "Plan" } },
    ]);
  });

  it("calls an unknown kind a conflict rather than printing its stored name", () => {
    const result = resolve(tripWith({ days: [dayWith(DAY_1, ["a1"])], conflicts: [conflictOf("something-new", "c9")] }));
    expect(labels(result)).toEqual(["Conflict on Day 1"]);
  });

  it("drops a dismissed conflict, because dismissing it WAS the decision", () => {
    // Asking twice about something already answered is the failure this guards:
    // the board filters the same set the same way (§25).
    const days = [dayWith(DAY_1, ["a1"])];
    const conflicts = [conflictOf("time-overlap", "c1")];
    expect(labels(resolve(tripWith({ days, conflicts })))).toEqual(["Overlap on Day 1"]);
    expect(resolve(tripWith({ days, conflicts, dismissedConflictIds: ["c1"] })).status).toBe("empty");
  });

  it("skips a backlog id with no activity behind it rather than counting it", () => {
    // The two fields are one projection and can only disagree mid-write.
    const result = resolve(tripWith({ days: [dayWith(DAY_1, ["a1"])], backlog: ["ghost"] }));
    expect(result.status).toBe("empty");
  });

  it("numbers an empty day by its position in the trip, not by its id", () => {
    const result = resolve(tripWith({ days: [dayWith(DAY_1, ["a1"]), dayWith(DAY_2, ["a1"]), dayWith(DAY_3, [])] }));
    expect(items(result)).toEqual([
      { label: "Day 3 has nothing on it", sub: "", right: "Plan it", tone: "info", act: { kind: "day", day: { kind: "dayId", dayId: DAY_3 } } },
    ]);
  });
});

// M43 decision 5: a class filter over the three row classes, and the `dates`
// dimension every day-selecting widget has, which a page's date scope fills
// when the widget leaves it open.
describe("`open` filters by class and by days (M43 decision 5)", () => {
  // Day 1 holds a clash, days 2 and 3 are empty, one idea is parked, and the
  // trip is over budget — every kind of row, so each filter has something to drop.
  const trip = tripWith({
    days: [dayWith(DAY_1, ["a1", "a3"], "2026-08-01"), dayWith(DAY_2, [], "2026-08-02"), dayWith(DAY_3, [], "2026-08-03")],
    conflicts: [conflictOf("time-overlap", "c1", ["a1", "a3"]), conflictOf("over-budget", "c4", [TRIP_ID])],
    backlog: ["p1"],
    activities: { a1: stop("Breakfast"), a3: stop("Shrine"), p1: stop("Ghibli Museum") } as unknown as TripDetail["activities"],
  });

  it("drops the parked row when the class filter leaves parked out", () => {
    expect(labels(resolve(trip, { class: ["conflict", "empty-day"] }))).toEqual([
      "Overlap on Day 1", "Over budget", "Day 2 has nothing on it", "Day 3 has nothing on it",
    ]);
    expect(labels(resolve(trip, { class: ["parked"] }))).toEqual(["1 idea is parked"]);
  });

  it("keeps only the chosen day's conflicts and empty days, and what is on no day", () => {
    // A parked idea has no date and the budget is the whole trip's, so a Days
    // filter cannot place either: only the class filter hides them.
    expect(labels(resolve(trip, { dates: ["2026-08-02"] }))).toEqual(["Over budget", "Day 2 has nothing on it", "1 idea is parked"]);
    expect(labels(resolve(trip, { dates: { from: "2026-08-01", through: "2026-08-01" } }))).toEqual([
      "Overlap on Day 1", "Over budget", "1 idea is parked",
    ]);
  });

  it("does not call the trip settled when a filter is what left nothing", () => {
    // The settled line says every day has something on it and no two stops
    // collide. With Parked alone ticked, or the Days filter on a day with
    // stops, neither is known — here both are false.
    const narrower = { status: "empty", because: "Nothing here needs you." };
    const unparked = { ...trip, backlog: [] };
    expect(resolve(unparked, { class: ["parked"] })).toEqual(narrower);
    const quiet = tripWith({
      days: [dayWith(DAY_1, ["a1"], "2026-08-01"), dayWith(DAY_2, ["a3"], "2026-08-02"), dayWith(DAY_3, [], "2026-08-03")],
      activities: { a1: stop("Breakfast"), a3: stop("Shrine") } as unknown as TripDetail["activities"],
    });
    expect(resolve(quiet, { dates: ["2026-08-02"] })).toEqual(narrower);
  });

  it("follows the notebook's date scope when no Days filter is set", () => {
    const today: WidgetContext = {
      trip, globals: null, user: null, today: null,
      page: { tripId: TRIP_ID, dateScope: "today" }, now: { at: Date.parse("2026-08-03T12:00:00Z"), deviceZone: "UTC" },
    };
    const rendered = renderMacro(today, "open", {});
    const rows = rendered.status === "ok" && rendered.rendered.kind === "items" ? rendered.rendered.items.map((item) => item.label) : [];
    expect(rows).toEqual(["Over budget", "Day 3 has nothing on it", "1 idea is parked"]);
  });
});
