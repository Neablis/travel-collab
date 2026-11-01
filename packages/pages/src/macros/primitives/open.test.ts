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

  it("folds same-kind conflicts on one day into ONE row that counts them (Mitchell, 2026-11-01)", () => {
    // `detectConflicts` raises one overlap per PAIR, so three stops that all
    // collide are three conflicts. One row each printed three identical lines
    // with the same link, and the reader could not tell why there were three.
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1", "a2", "a3"], "2026-08-01")],
        conflicts: [
          conflictOf("time-overlap", "c12", ["a1", "a2"]),
          conflictOf("time-overlap", "c13", ["a1", "a3"]),
          conflictOf("time-overlap", "c23", ["a2", "a3"]),
        ],
        activities: { a1: stop("Breakfast", "Kyoto"), a2: stop("Shrine", "Kyoto"), a3: stop("Market", "Kyoto") } as unknown as TripDetail["activities"],
      }),
    );
    expect(items(result)).toEqual([
      {
        label: "3 overlaps on Day 1", sub: "Aug 1 · Kyoto", right: "Fix in Plan", tone: "warning",
        act: { kind: "day", day: { kind: "dayId", dayId: DAY_1 } },
      },
    ]);
  });

  it("keeps different kinds, and the same kind on different days, as separate rows", () => {
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1", "a2"]), dayWith(DAY_2, ["a3", "a4"])],
        conflicts: [
          conflictOf("time-overlap", "c1", ["a1", "a2"]),
          conflictOf("impossible-geography", "c2", ["a1", "a2"]),
          conflictOf("time-overlap", "c3", ["a3", "a4"]),
        ],
      }),
    );
    expect(labels(result)).toEqual(["Overlap on Day 1", "Too far on Day 1", "Overlap on Day 2"]);
  });

  it("folds conflicts on no day by kind alone, and says the sentence under it is only the first", () => {
    // Two parked stops whose time windows break their anchors: `anchorViolated`
    // checks the window alone, so a stop in the rack still raises one, on no
    // day. The row counts two, so a sub that kept only Museum's sentence read
    // as a row about Museum alone (PR 660 review).
    const anchor = (id: string, subject: string, title: string) => ({
      ...conflictOf("anchor-violation", id, [subject]),
      description: `"${title}" has an anchor its current placement (an unscheduled slot) does not satisfy.`,
    });
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1"])],
        conflicts: [anchor("c1", "p1", "Museum"), anchor("c2", "p2", "Night market")],
      }),
    );
    expect(items(result)).toEqual([
      {
        label: "2 anchors broken",
        sub: 'First of 2: "Museum" has an anchor its current placement (an unscheduled slot) does not satisfy.',
        right: "Fix in Plan", tone: "warning", act: { kind: "view", view: "Plan" },
      },
    ]);
  });

  it("has a plural for every kind it has a label for", () => {
    // A kind with a label but no plural folds to "2 conflicts": true, but a
    // step back from what the same kind says when there is one of it.
    const kinds = ["time-overlap", "impossible-geography", "anchor-violation", "over-budget"];
    const result = resolve(
      tripWith({
        days: [dayWith(DAY_1, ["a1", "a2"])],
        conflicts: kinds.flatMap((kind) => [conflictOf(kind, `${kind}-1`, ["a1"]), conflictOf(kind, `${kind}-2`, ["a2"])]),
      }),
    );
    expect(labels(result)).toEqual([
      "2 overlaps on Day 1", "2 journeys too far on Day 1", "2 anchors broken on Day 1", "2 over budget on Day 1",
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

  it("filters folded conflict rows by class and by day, keeping each day's count whole", () => {
    // Parts 3 and 4 both rewrote the conflict loop: the fold must sit inside
    // the class filter and above the Days filter, or one of them goes missing.
    const clashing = tripWith({
      days: [dayWith(DAY_1, ["a1", "a2", "a3"], "2026-08-01"), dayWith(DAY_2, ["a4", "a5"], "2026-08-02")],
      conflicts: [
        conflictOf("time-overlap", "c12", ["a1", "a2"]),
        conflictOf("time-overlap", "c13", ["a1", "a3"]),
        conflictOf("time-overlap", "c45", ["a4", "a5"]),
        conflictOf("time-overlap", "c45b", ["a4", "a5"]),
      ],
    });
    expect(labels(resolve(clashing, { dates: ["2026-08-02"] }))).toEqual(["2 overlaps on Day 2"]);
    expect(labels(resolve(clashing, { class: ["conflict"] }))).toEqual(["2 overlaps on Day 1", "2 overlaps on Day 2"]);
    expect(resolve(clashing, { class: ["empty-day", "parked"] })).toEqual({ status: "empty", because: "Nothing here needs you." });
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

  // Mitchell, 2026-11-01 (M43 part 5): the notebook's scope is not a filter the
  // reader set, so a quiet scoped day is the good news, said for that day. The
  // Overview turns into the Today notebook as the trip nears, and drawing the
  // muted chip there made the same settled trip flip between two looks. A Days
  // filter the author set keeps the muted line: the test two above.
  describe("when only a scope hid the other days", () => {
    const settled = tripWith({
      days: [dayWith(DAY_1, ["a1"], "2026-08-01"), dayWith(DAY_2, ["a3"], "2026-08-02"), dayWith(DAY_3, ["a4"], "2026-08-03")],
      activities: { a1: stop("Breakfast"), a3: stop("Shrine"), a4: stop("Temple") } as unknown as TripDetail["activities"],
    });
    const onDay2: WidgetContext = {
      trip: settled, globals: null, user: null, today: null,
      page: { tripId: TRIP_ID, dateScope: "today" }, now: { at: Date.parse("2026-08-02T12:00:00Z"), deviceZone: "UTC" },
    };

    it("says nothing needs you today on a Today notebook", () => {
      expect(renderMacro(onDay2, "open", {})).toEqual({ status: "empty", because: "Nothing needs you today", good: true });
    });

    it("names the day when the scoped day is not today", () => {
      expect(open.resolve(onDay2, {}, { kind: "day", index: 2 })).toEqual({ status: "empty", because: "Nothing needs you on Day 3", good: true });
    });

    // A Show filter the reader set may have hidden parked ideas or empty days,
    // so the day is not known to be settled: the muted chip stays.
    it("keeps the muted chip when a Show filter left nothing", () => {
      expect(renderMacro(onDay2, "open", { class: ["conflict"] })).toEqual({ status: "empty", because: "Nothing here needs you." });
    });

    // The notebook's today supersedes a stored Days filter, so no filter the
    // reader can see hid anything.
    it("says nothing needs you today over a stored Days filter", () => {
      expect(renderMacro(onDay2, "open", { dates: ["2026-08-01"] })).toEqual({ status: "empty", because: "Nothing needs you today", good: true });
    });
  });

  // Mitchell, 2026-11-01: the Overview is the Today notebook from three days
  // out, and "Nothing planned today" there hid the clashes just ahead. Before
  // day 1 the widget checks the whole trip; after the last day it does not.
  describe("on a Today notebook off the trip's dates", () => {
    const quiet = tripWith({
      days: [dayWith(DAY_1, ["a1"], "2026-08-01"), dayWith(DAY_2, ["a3", "a4"], "2026-08-02"), dayWith(DAY_3, ["a5"], "2026-08-03")],
      activities: { a1: stop("Breakfast"), a3: stop("Shrine"), a4: stop("Temple"), a5: stop("Market") } as unknown as TripDetail["activities"],
    });
    const clashing = { ...quiet, conflicts: [conflictOf("time-overlap", "c34", ["a3", "a4"])] };
    const at = (trip: TripDetail, instant: string): WidgetContext => ({
      trip, globals: null, user: null, today: null,
      page: { tripId: TRIP_ID, dateScope: "today" }, now: { at: Date.parse(instant), deviceZone: "UTC" },
    });

    it("lists a clash on the days ahead before the trip starts", () => {
      const rendered = renderMacro(at(clashing, "2026-07-30T12:00:00Z"), "open", {});
      const rows = rendered.status === "ok" && rendered.rendered.kind === "items" ? rendered.rendered.items.map((item) => item.label) : rendered;
      expect(rows).toEqual(["Overlap on Day 2"]);
    });

    // More than 3 days out the trip is still planning, not soon: the whole trip all the same.
    it("lists a clash on the days ahead while the trip is still being planned", () => {
      const rendered = renderMacro(at(clashing, "2026-07-20T12:00:00Z"), "open", {});
      const rows = rendered.status === "ok" && rendered.rendered.kind === "items" ? rendered.rendered.items.map((item) => item.label) : rendered;
      expect(rows).toEqual(["Overlap on Day 2"]);
    });

    // A city line keeps its own scope, so before day 1 it has no day to check.
    it("says nothing is planned today on a city line before the trip starts", () => {
      expect(renderMacro(at(clashing, "2026-07-30T12:00:00Z"), "open", {}, { kind: "city", name: "Kyoto" }))
        .toEqual({ status: "empty", because: "Nothing planned today" });
    });

    // No `because`, so MacroView draws `emptyText`: the whole trip's settled line.
    it("says the whole trip is settled before it starts", () => {
      expect(renderMacro(at(quiet, "2026-07-30T12:00:00Z"), "open", {})).toEqual({ status: "empty" });
    });

    it("says nothing is planned today once the trip has ended", () => {
      expect(renderMacro(at(clashing, "2026-08-05T12:00:00Z"), "open", {})).toEqual({ status: "empty", because: "Nothing planned today" });
    });
  });
});
