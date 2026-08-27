import { describe, expect, it } from "vitest";
import { tripStatesEqual, type TripState } from "../src";

const base: TripState = {
  tripId: "7d9a1f8e-0000-4000-8000-00000000000a",
  name: "Rome",
  members: [{ userId: "u1", role: "owner" }],
  startDate: null,
  days: [{ dayId: "7d9a1f8e-0000-4000-8000-00000000000d", activityIds: [] }],
  backlog: ["7d9a1f8e-0000-4000-8000-0000000000a1"],
  activities: {
    "7d9a1f8e-0000-4000-8000-0000000000a1": { title: "Colosseum", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
  },
  dismissedConflictIds: [],
  currency: "USD",
  budget: null,
  status: "active" as const,
};

describe("tripStatesEqual", () => {
  it("is true for structurally identical states regardless of activity key order", () => {
    const twoActivities = {
      ...base,
      backlog: [...base.backlog, "7d9a1f8e-0000-4000-8000-0000000000a2"],
      activities: {
        ...base.activities,
        "7d9a1f8e-0000-4000-8000-0000000000a2": { title: "Vatican", timeWindow: null, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      },
    };
    const reversedKeys = {
      ...twoActivities,
      activities: Object.fromEntries(Object.entries(twoActivities.activities).reverse()),
    };
    expect(tripStatesEqual(twoActivities, reversedKeys)).toBe(true);
  });

  // Members are compared field by field (equality.ts hand-enumerates userId
  // and role), so widening the role is exactly the kind of change that can
  // leave a field uncompared — and an uncompared field makes a real change
  // look like a no-op to `okUnlessNoOp`. Nothing mints a non-owner member
  // until invites (M11 link 3), so this can only be asserted directly.
  it("is false when two members differ only by role", () => {
    expect(
      tripStatesEqual(base, { ...base, members: [{ userId: "u1", role: "editor" }] }),
    ).toBe(false);
    expect(
      tripStatesEqual(
        { ...base, members: [{ userId: "u1", role: "owner" }, { userId: "u2", role: "viewer" }] },
        { ...base, members: [{ userId: "u1", role: "owner" }, { userId: "u2", role: "editor" }] },
      ),
    ).toBe(false);
  });

  it("is false when order-bearing lists differ", () => {
    expect(tripStatesEqual(base, { ...base, backlog: [] })).toBe(false);
    expect(tripStatesEqual(base, { ...base, startDate: "2026-10-12" })).toBe(false);
    expect(tripStatesEqual(base, { ...base, dismissedConflictIds: ["x"] })).toBe(false);
  });

  it("treats a status difference as a difference", () => {
    const a = base;
    const b = { ...a, status: "deleted" as const };
    expect(tripStatesEqual(a, b)).toBe(false);
  });
});
