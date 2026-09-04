import { describe, expect, it } from "vitest";
import type { ActivityView, TripDetail, TripGlobals } from "@tc/contracts";
import { dayDate, dayCity, dayWindow, budgetRemaining } from "./day";

const activity = (id: string, start: string | null, end: string | null): ActivityView => ({
  activityId: id, title: id, timeWindow: start && end ? { start, end } : null,
  location: null, notes: null, anchors: [], kind: "planned", tags: [], cost: null,
});

const base: TripDetail = {
  tripId: "11111111-1111-1111-1111-111111111111",
  name: "Japan 2026", startDate: "2026-08-01", currency: "USD", budget: { amountMinor: 100000, currency: "USD" }, status: "active",
  members: [{ userId: "u1", role: "owner" }],
  forkedFrom: null,
  days: [
    { dayId: "d0", activityIds: ["a-late", "a-early", "a-untimed"], date: "2026-08-01", costSubtotal: 5000 },
    { dayId: "d1", activityIds: [], date: null, costSubtotal: 0 },
  ],
  backlog: [],
  activities: {
    "a-late": activity("a-late", "14:00", "21:30"),
    "a-early": activity("a-early", "09:00", "10:15"),
    "a-untimed": activity("a-untimed", null, null),
  },
  conflicts: [], dismissedConflictIds: [],
  createdAt: "2026-07-20T00:00:00.000Z",
  unscheduledCostSubtotal: 0, tripCostTotal: 5000, budgetRemaining: 95000,
};

const globals: TripGlobals = {
  days: [
    { index: 0, date: "2026-08-01", cities: ["Tokyo", "Kyoto"], activityCount: 3, costSubtotal: 5000 },
    { index: 1, date: null, cities: [], activityCount: 0, costSubtotal: 0 },
  ],
  cities: [], tags: [], bookedCount: 0,
};

const page = { tripId: base.tripId };
const at = (index: number) => ({ dayRef: { kind: "index", index } as const });
const ctx = (over: Partial<{ trip: TripDetail; globals: TripGlobals | null }> = {}) =>
  ({ trip: base, page, user: null, globals: null, ...over });

describe("day.date", () => {
  it("resolves the date of the day in its own params", () => {
    expect(dayDate.resolve(ctx(), at(0))).toEqual({ status: "ok", value: "Aug 1, 2026" });
  });

  // A trip planned as "day 1, day 2" before it is planned as dates. `formatDate`
  // would return "—" here, and an em dash printed into someone's sentence reads
  // as a value; `empty()` lets `emptyText` say what is true.
  it("is empty for a day with no date, rather than an em dash", () => {
    expect(dayDate.resolve(ctx(), at(1)).status).toBe("empty");
  });

  it("is unbound with no day chosen, and for a day that no longer exists", () => {
    expect(dayDate.resolve(ctx(), {}).status).toBe("unbound");
    expect(dayDate.resolve(ctx(), at(99)).status).toBe("unbound");
  });

  it("needs a trip on an account-scope notebook", () => {
    expect(dayDate.resolve({ page, user: null, globals: null }, at(0))).toEqual({ status: "unbound", needs: "trip" });
  });
});

describe("day.city", () => {
  // The route item D exists to provide: cities are derived by `citiesOfDay` in
  // `@tc/domain`, which this package may not import, so they arrive via globals.
  it("reads the day's cities from globals, in arrival order", () => {
    expect(dayCity.resolve(ctx({ globals }), at(0))).toEqual({ status: "ok", value: "Tokyo – Kyoto" });
  });

  it("is empty for a day that touches no located stop", () => {
    expect(dayCity.resolve(ctx({ globals }), at(1)).status).toBe("empty");
  });

  // Globals is a separate request that can fail. Inert, not a guess and not a
  // page that will not open — the trade `account.name` already makes for `user`.
  it("is empty rather than throwing when globals did not load", () => {
    expect(dayCity.resolve(ctx({ globals: null }), at(0)).status).toBe("empty");
  });
});

describe("day.window", () => {
  // The load-bearing case. `activityIds` is the board's order, and day 0 stores
  // the 14:00 stop FIRST. Reading `activityIds[0]` would answer "the first stop
  // in the column", which is a different question and wrong exactly when the
  // board is untidy.
  it("takes the earliest start and latest end, not the first and last stored", () => {
    expect(dayWindow.resolve(ctx(), at(0))).toEqual({ status: "ok", value: "09:00 – 21:30" });
  });

  it("skips untimed stops rather than counting them as midnight", () => {
    // "a-untimed" is on day 0 above; a 00:00 reading would make the start 00:00.
    const r = dayWindow.resolve(ctx(), at(0));
    expect(r.status === "ok" && r.value.startsWith("09:00")).toBe(true);
  });

  it("is empty for a day whose stops all have no time", () => {
    const untimedOnly = { ...base, days: [{ ...base.days[0]!, activityIds: ["a-untimed"] }, base.days[1]!] };
    expect(dayWindow.resolve(ctx({ trip: untimedOnly }), at(0)).status).toBe("empty");
  });
});

describe("budget.remaining", () => {
  it("formats what is left", () => {
    expect(budgetRemaining.resolve(ctx(), {})).toEqual({ status: "ok", value: "$950.00" });
  });

  // Over budget is the reading that changes a decision, so it is rendered
  // rather than clamped.
  it("renders a negative remainder rather than hiding it", () => {
    const over = { ...base, budgetRemaining: -2500 };
    expect(budgetRemaining.resolve(ctx({ trip: over }), {})).toEqual({ status: "ok", value: "-$25.00" });
  });

  it("is empty when no budget is set, which is not the same as nothing left", () => {
    const noBudget = { ...base, budget: null, budgetRemaining: null };
    expect(budgetRemaining.resolve(ctx({ trip: noBudget }), {}).status).toBe("empty");
  });
});
