import { describe, expect, it } from "vitest";
import type { Anchor } from "@tc/contracts";
import { DEFAULT_CONFLICT_CONTEXT, detectConflicts, type TripState } from "../src";

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";
const DAY = "7d9a1f8e-0000-4000-8000-00000000000d";
const A1 = "7d9a1f8e-0000-4000-8000-0000000000a1";

// A one-day trip whose only activity carries `anchors`, pinned to `startDate`.
function dated(startDate: string | null, anchors: Anchor[], timeWindow: TripState["activities"][string]["timeWindow"] = null): TripState {
  return {
    tripId: TRIP, name: "Rome", members: [{ userId: "u1", role: "owner" }],
    startDate, days: [{ dayId: DAY, activityIds: [A1] }], backlog: [],
    activities: { [A1]: { title: "Market", timeWindow, location: null, notes: null, anchors, cost: null } },
    dismissedConflictIds: [],
    currency: "USD", budget: null,
    status: "active",
  };
}

describe("anchor-violation rule", () => {
  it("dayOfWeek: violated when the derived weekday is excluded, satisfied otherwise", () => {
    // 2026-10-12 is a Monday. Anchor allows only weekends → violated.
    const bad = detectConflicts(dated("2026-10-12", [{ kind: "dayOfWeek", days: ["sat", "sun"] }]));
    expect(bad).toHaveLength(1);
    expect(bad[0]!.kind).toBe("anchor-violation");
    expect(bad[0]!.severity).toBe("warn");
    expect(bad[0]!.id).toBe(`anchor-violation:${A1}:dow:sat,sun`);
    // Allow Monday → satisfied.
    expect(detectConflicts(dated("2026-10-12", [{ kind: "dayOfWeek", days: ["mon"] }]))).toHaveLength(0);
  });

  it("dateRange: violated outside [from,to], satisfied inside", () => {
    expect(detectConflicts(dated("2026-10-12", [{ kind: "dateRange", from: "2026-10-01", to: "2026-10-10" }]))).toHaveLength(1);
    expect(detectConflicts(dated("2026-10-12", [{ kind: "dateRange", from: "2026-10-12", to: "2026-10-12" }]))).toHaveLength(0);
  });

  it("timeOfDay: violated when the activity window escapes the opening window; evaluated even when undated", () => {
    const outside = detectConflicts(dated(null, [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }], { start: "12:00", end: "14:00" }));
    expect(outside).toHaveLength(1);
    const inside = detectConflicts(dated(null, [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }], { start: "09:00", end: "11:00" }));
    expect(inside).toHaveLength(0);
    // No time window on the activity → dormant.
    expect(detectConflicts(dated(null, [{ kind: "timeOfDay", window: { start: "08:00", end: "13:00" } }], null))).toHaveLength(0);
  });

  it("date-based anchors go dormant when the trip is undated", () => {
    expect(detectConflicts(dated(null, [{ kind: "dayOfWeek", days: ["sat"] }]))).toHaveLength(0);
    expect(detectConflicts(dated(null, [{ kind: "dateRange", from: "2026-01-01", to: "2026-01-02" }]))).toHaveLength(0);
  });

  it("publicHoliday is inert under the default (permissive) context", () => {
    expect(detectConflicts(dated("2026-10-12", [{ kind: "publicHoliday", country: "US" }]))).toHaveLength(0);
    // Prove the seam is real: a strict oracle would flag it.
    const strict = { ...DEFAULT_CONFLICT_CONTEXT, isPublicHoliday: () => false };
    expect(detectConflicts(dated("2026-10-12", [{ kind: "publicHoliday", country: "US" }]), strict)).toHaveLength(1);
  });
});
