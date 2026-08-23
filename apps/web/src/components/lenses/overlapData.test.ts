import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { overlapsForDay } from "./overlapData";

// The plan's own worked example (M10 Phase 5): Nezu Museum 10:30–13:00 and
// Lunch at Kagari 12:30–14:00 on one day, 30 minutes on top of each other,
// with the single `time-overlap` conflict the domain emits for that pair.
// Short ids ("d1", "a", "b") rather than uuids so the conflict id reads the
// way conflicts.ts builds it — nothing here parses them as uuids.
const detail = (over: Partial<TripDetail> = {}): TripDetail =>
  tripDetailFixture({
    days: [{ dayId: "d1", date: null, activityIds: ["a", "b"], costSubtotal: 0 }],
    activities: {
      a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], cost: null },
      b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "12:30", end: "14:00" }, location: null, notes: null, anchors: [], cost: null },
    },
    conflicts: [
      {
        id: "time-overlap:d1:a:b",
        kind: "time-overlap",
        severity: "warn",
        subjects: ["a", "b"],
        description: '"Nezu Museum" and "Lunch at Kagari" overlap in time on the same day.',
        resolutions: [],
      },
    ],
    ...over,
  });

describe("overlapsForDay", () => {
  it("attaches the warning to the later stop", () => {
    const [o] = overlapsForDay(detail(), "d1");
    expect(o?.laterActivityId).toBe("b");
    expect(o?.otherTitle).toBe("Nezu Museum");
  });

  it("reports the true intersection, not the whole span", () => {
    // 12:30–13:00 = 30 minutes.
    expect(overlapsForDay(detail(), "d1")[0]?.overlapMinutes).toBe(30);
  });

  it("suggests starting when the earlier stop ends", () => {
    expect(overlapsForDay(detail(), "d1")[0]?.suggestedStart).toBe("13:00");
  });

  it("excludes dismissed conflicts", () => {
    expect(overlapsForDay(detail({ dismissedConflictIds: ["time-overlap:d1:a:b"] }), "d1")).toEqual([]);
  });

  it("ignores conflicts belonging to another day", () => {
    expect(overlapsForDay(detail(), "d2")).toEqual([]);
  });

  it("ignores non-overlap conflict kinds", () => {
    const d = detail({
      conflicts: [{ id: "over-budget", kind: "over-budget", severity: "warn", subjects: [], description: "", resolutions: [] }],
    });
    expect(overlapsForDay(d, "d1")).toEqual([]);
  });

  it("skips a conflict naming a missing activity rather than throwing", () => {
    const d = detail({
      conflicts: [
        { id: "time-overlap:d1:a:zzz", kind: "time-overlap", severity: "warn", subjects: ["a", "zzz"], description: "", resolutions: [] },
      ],
    });
    expect(() => overlapsForDay(d, "d1")).not.toThrow();
    expect(overlapsForDay(d, "d1")).toEqual([]);
  });

  it("breaks a same-start tie on the later end, so the pair still resolves deterministically", () => {
    const d = detail({
      activities: {
        a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], cost: null },
        b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "10:30", end: "11:00" }, location: null, notes: null, anchors: [], cost: null },
      },
    });
    const [o] = overlapsForDay(d, "d1");
    expect(o?.laterActivityId).toBe("a");
    // The earlier stop of the pair is still the one whose end the fix suggests.
    expect(o?.suggestedStart).toBe("11:00");
  });
});
