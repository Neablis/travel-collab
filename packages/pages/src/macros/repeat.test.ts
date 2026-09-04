import { describe, expect, it } from "vitest";
import type { ActivityView, TripDetail, TripGlobals } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import type { RepeatPayload, Seg } from "../registry-types";
import { dayLine, cityLine, bookingLine, stopLine } from "./repeat";

const activity = (id: string, over: Partial<ActivityView> = {}): ActivityView => ({
  activityId: id, title: id, timeWindow: null, location: null, notes: null,
  anchors: [], kind: "planned", tags: [], cost: null, ...over,
});

// From the factory, overriding only what these cases are about (AGENTS.md:
// "data comes from `@tc/factories`, never a hand-built rollup"). Copilot, PR 139.
const base: TripDetail = tripDetailFixture({
  name: "Japan 2026",
  startDate: "2026-08-01",
  budget: { amountMinor: 100000, currency: "USD" },
  days: [
    { dayId: "d0", activityIds: ["booked-1", "planned-1"], date: "2026-08-01", costSubtotal: 12000 },
    { dayId: "d1", activityIds: ["planned-2"], date: "2026-08-02", costSubtotal: 0 },
  ],
  activities: {
    "booked-1": activity("booked-1", {
      title: "Ryokan", kind: "booked", timeWindow: { start: "15:00", end: "23:00" },
      cost: { amountMinor: 12000, currency: "USD" },
    }),
    "planned-1": activity("planned-1", { title: "Market" }),
    "planned-2": activity("planned-2", { title: "Walk" }),
  },
  tripCostTotal: 12000,
  budgetRemaining: 88000,
});

const globals: TripGlobals = {
  days: [
    { index: 0, date: "2026-08-01", cities: ["Tokyo"], activityCount: 2, costSubtotal: 12000 },
    { index: 1, date: "2026-08-02", cities: [], activityCount: 1, costSubtotal: 0 },
  ],
  cities: [{ name: "Tokyo", dayIndexes: [0], activityCount: 2 }],
  tags: [], bookedCount: 1,
};

const page = { tripId: base.tripId };
const ctx = (over: Partial<{ trip: TripDetail; globals: TripGlobals | null }> = {}) =>
  ({ trip: base, page, user: null, globals: null, ...over });
const rowsOf = (r: ReturnType<typeof dayLine.resolve>) =>
  (r as { status: "ok"; value: RepeatPayload }).value.rows;

describe("day.line", () => {
  it("emits one row per day, leading with the day NUMBER a person counts from", () => {
    const rows = rowsOf(dayLine.resolve(ctx({ globals }), {}));
    expect(rows).toHaveLength(2);
    // Day 1, not Day 0. `dayIndexes` counts from 0 because that is how the
    // projection addresses days; a page saying "Day 0" leaks that convention.
    expect(rows[0]!.lead).toBe("Day 1");
    expect(rows[1]!.lead).toBe("Day 2");
  });

  it("carries the date, the cities and the cost as the line's values", () => {
    const rows = rowsOf(dayLine.resolve(ctx({ globals }), {}));
    expect(rows[0]!.values).toEqual(["Aug 1, 2026", "Tokyo", "$120.00"]);
  });

  // The honest degradation. Globals is a separate request, and dropping the
  // whole line because one projection is late would lose the days themselves.
  it("still renders every day, one value shorter, when globals did not load", () => {
    const rows = rowsOf(dayLine.resolve(ctx({ globals: null }), {}));
    expect(rows).toHaveLength(2);
    expect(rows[0]!.values).toEqual(["Aug 1, 2026", "$120.00"]);
  });

  it("omits a zero cost rather than printing $0.00 on every quiet day", () => {
    const rows = rowsOf(dayLine.resolve(ctx({ globals }), {}));
    expect(rows[1]!.values).toEqual(["Aug 2, 2026"]);
  });

  it("is empty for a trip with no days, and needs a trip without one", () => {
    expect(dayLine.resolve(ctx({ trip: { ...base, days: [] } }), {}).status).toBe("empty");
    expect(dayLine.resolve({ page, user: null, globals: null }, {})).toEqual({ status: "unbound", needs: "trip" });
  });
});

describe("city.line", () => {
  it("emits one row per city, with its days numbered from 1 and its stop count", () => {
    const rows = rowsOf(cityLine.resolve(ctx({ globals }), {}));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lead).toBe("Tokyo");
    expect(rows[0]!.values).toEqual(["Day 1", "2 stops"]);
  });

  it("says '1 stop', not '1 stops'", () => {
    const one = { ...globals, cities: [{ name: "Kyoto", dayIndexes: [1], activityCount: 1 }] };
    expect(rowsOf(cityLine.resolve(ctx({ globals: one }), {}))[0]!.values).toEqual(["Day 2", "1 stop"]);
  });

  // Cities are derived by `citiesOfDay` in `@tc/domain`, which this package may
  // not import, so with no globals there is no city list to show — and an
  // invented one would be worse than saying so.
  it("is empty without the globals projection rather than inventing a list", () => {
    expect(cityLine.resolve(ctx({ globals: null }), {}).status).toBe("empty");
  });
});

describe("booking.line", () => {
  const day0 = { dayRef: { kind: "index", index: 0 } as const };

  it("emits a row for the booked stop and skips the merely planned one", () => {
    const rows = rowsOf(bookingLine.resolve(ctx(), day0));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.lead).toBe("Ryokan");
    expect(rows[0]!.values).toEqual(["15:00 – 23:00", "$120.00"]);
  });

  // A day with stops but none booked. A different sentence from "no stops",
  // and `emptyText` is the one that says which.
  it("is empty for a day whose stops are all planned", () => {
    expect(bookingLine.resolve(ctx(), { dayRef: { kind: "index", index: 1 } }).status).toBe("empty");
  });

  it("is unbound until it is pointed at a day", () => {
    expect(bookingLine.resolve(ctx(), {}).status).toBe("unbound");
  });
});

// ADR-037 decision 3a, on the shape that did not exist when that rule was
// written. A repeater emits more segments than anything else in the registry,
// so if a widget could smuggle markup out this is where it would show.
describe("what a repeater renders", () => {
  it("renders one Seg row per item: a text lead, then chips", () => {
    const rendered = dayLine.render((dayLine.resolve(ctx({ globals }), {}) as { status: "ok"; value: RepeatPayload }).value);
    expect(rendered.kind).toBe("rows");
    const rows = (rendered as { kind: "rows"; rows: Seg[][] }).rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]![0]).toEqual({ kind: "text", text: "Day 1" });
    expect(rows[0]!.slice(1).every((s) => s.kind === "chip")).toBe(true);
    // The union has nowhere to put an element, an attribute or a URL, and this
    // asserts the repeaters stay inside it.
    expect(rows.flat().every((s) => s.kind === "text" || s.kind === "chip")).toBe(true);
  });
});

// `w-stopline` — the catalogue's "only two-input widget, so it is the one that
// proves the model". Everything else takes one thing or nothing, so this is the
// first widget whose two bindings can interfere.
describe("stop.line", () => {
  const day0 = { dayRef: { kind: "index", index: 0 } as const };

  it("lists every stop on the day when no tag is bound", () => {
    // Unset is a real answer, not an unfilled blank (§18: "every stop, or one"),
    // so the widget is useful the moment it has a day.
    const rows = rowsOf(stopLine.resolve(ctx(), day0));
    expect(rows.map((r) => r.lead)).toEqual(["Ryokan", "Market"]);
  });

  it("filters to the stops carrying the bound tag", () => {
    const tagged = {
      ...base,
      activities: {
        ...base.activities,
        "planned-1": activity("planned-1", { title: "Market", tags: ["meal"] }),
      },
    };
    const rows = rowsOf(stopLine.resolve(ctx({ trip: tagged }), { ...day0, tag: "meal" }));
    expect(rows.map((r) => r.lead)).toEqual(["Market"]);
  });

  // A filter that quietly stops filtering is worse than one that finds nothing:
  // the reader would believe the list was complete for that tag.
  it("is empty when the bound tag matches no stop, rather than dropping the filter", () => {
    expect(stopLine.resolve(ctx(), { ...day0, tag: "lodging" }).status).toBe("empty");
  });

  // `emptyText` is a fixed string on the definition and cannot see the params,
  // so it has to be true of BOTH empty cases. It said "no stops on this day",
  // which on a day full of stops filtered to a tag none carry is a claim the
  // widget cannot keep — the reader is told the day is empty when it is not
  // (Copilot, PR 139).
  it("says nothing is showing, not that the day is empty, since it cannot tell which", () => {
    expect(stopLine.emptyText).not.toMatch(/no stops on this day/);
    expect(stopLine.emptyText).toBe("no stops to show for this day");
  });

  it("carries each stop's time and cost as the line's values", () => {
    expect(rowsOf(stopLine.resolve(ctx(), day0))[0]!.values).toEqual(["15:00 – 23:00", "$120.00"]);
  });

  it("is unbound until it is pointed at a day, whatever the tag says", () => {
    expect(stopLine.resolve(ctx(), {}).status).toBe("unbound");
    expect(stopLine.resolve(ctx(), { tag: "meal" }).status).toBe("unbound");
  });
});
