import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFixture } from "@tc/factories";
import { badgeableConflictSubjects, overlapsForDay } from "./overlapData";

// The plan's own worked example (M10 Phase 5): Nezu Museum 10:30–13:00 and
// Lunch at Kagari 12:30–14:00 on one day, 30 minutes on top of each other,
// with the single `time-overlap` conflict the domain emits for that pair.
// Short ids ("d1", "a", "b") rather than uuids so the conflict id reads the
// way conflicts.ts builds it — nothing here parses them as uuids.
const detail = (over: Partial<TripDetail> = {}): TripDetail =>
  tripDetailFixture({
    days: [{ dayId: "d1", date: null, activityIds: ["a", "b"], costSubtotal: 0 }],
    activities: {
      a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "12:30", end: "14:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
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

  // CodeRabbit on PR #44. overlapsForDay filtered by the day encoded in the
  // conflict id, not by where the activities actually are now. A stale
  // conflict for a stop that has since moved to another day still came back
  // as an overlap of its OLD day — so TimelineLens counted it in
  // renderedOverlapIds (suppressing the triangle) while rendering no warning
  // for it, because its warning only renders next to a stop that day actually
  // holds. Same invisible-conflict class KI-29 closed, reached a different way.
  it("ignores a conflict whose subject has moved off the encoded day", () => {
    const moved = detail({
      days: [
        { dayId: "d1", date: null, activityIds: ["a"], costSubtotal: 0 },
        { dayId: "d2", date: null, activityIds: ["b"], costSubtotal: 0 },
      ],
    });
    // The conflict still says "time-overlap:d1:a:b" and both stops still have
    // their time windows — only b's day membership changed.
    expect(overlapsForDay(moved, "d1")).toEqual([]);
    expect(overlapsForDay(moved, "d2")).toEqual([]);
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

  // The fix is "move the later stop, keeping its duration" — so the end it
  // should land on is derived here, once, rather than replayed through
  // toTimeString at each call site (whose clamp would silently shorten a stop
  // that runs past midnight).
  it("carries the end the duration-preserving move lands on", () => {
    // b is 12:30–14:00, a 90-minute stop: moved to 13:00 it ends at 14:30.
    expect(overlapsForDay(detail(), "d1")[0]?.suggestedEnd).toBe("14:30");
  });

  it("offers no end when the duration-preserving move would run past midnight", () => {
    const d = detail({
      activities: {
        a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "20:00", end: "23:45" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
        b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "23:30", end: "23:59" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      },
    });
    const [o] = overlapsForDay(d, "d1");
    // The warning still stands — only its fix is impossible: 23:45 + 29m is
    // 00:14 the next day, and a timeWindow lives within one day.
    expect(o?.laterActivityId).toBe("b");
    expect(o?.suggestedStart).toBe("23:45");
    expect(o?.suggestedEnd).toBeNull();
  });

  it("still offers a move that lands exactly on the day's last minute", () => {
    const d = detail({
      activities: {
        a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "20:00", end: "23:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
        b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "22:30", end: "23:29" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      },
    });
    expect(overlapsForDay(d, "d1")[0]?.suggestedEnd).toBe("23:59");
  });

  it("breaks a same-start tie on the later end, so the pair still resolves deterministically", () => {
    const d = detail({
      activities: {
        a: { activityId: "a", title: "Nezu Museum", timeWindow: { start: "10:30", end: "13:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
        b: { activityId: "b", title: "Lunch at Kagari", timeWindow: { start: "10:30", end: "11:00" }, location: null, notes: null, anchors: [], kind: "planned" as const, tags: [], cost: null },
      },
    });
    const [o] = overlapsForDay(d, "d1");
    expect(o?.laterActivityId).toBe("a");
    // The earlier stop of the pair is still the one whose end the fix suggests.
    expect(o?.suggestedStart).toBe("11:00");
  });
});

// KI-29: the triangle is suppressed per *rendered* overlap, not per kind. The
// day columns chip one overlap per stop, so a stop that is the later half of
// two crossing pairs leaves one pair unrendered — and that pair is exactly
// what this rule has to keep badging, or it has no day-column surface at all.
describe("badgeableConflictSubjects", () => {
  const overlapConflict = (id: string, subjects: string[]) => ({
    id,
    kind: "time-overlap" as const,
    severity: "warn" as const,
    subjects,
    description: "",
    resolutions: [],
  });

  it("badges the subjects of a kind nothing richer covers", () => {
    const d = detail({
      conflicts: [{ id: "anchor-broken:a", kind: "anchor-broken", severity: "warn", subjects: ["a"], description: "", resolutions: [] }],
    });
    expect([...badgeableConflictSubjects(d, new Set())]).toEqual(["a"]);
  });

  it("leaves a rendered overlap to its warning rather than also badging it", () => {
    const d = detail();
    expect([...badgeableConflictSubjects(d, new Set(["time-overlap:d1:a:b"]))]).toEqual([]);
  });

  it("badges an overlap the calling lens does not render, on both its subjects", () => {
    const d = detail({
      conflicts: [overlapConflict("time-overlap:d1:a:b", ["a", "b"]), overlapConflict("time-overlap:d1:b:c", ["b", "c"])],
    });
    // The board chips a:b on b and has no room for b:c — so b:c is the one
    // that still needs the triangle.
    const badged = badgeableConflictSubjects(d, new Set(["time-overlap:d1:a:b"]));
    expect([...badged].sort()).toEqual(["b", "c"]);
  });

  it("does not resurrect a triangle for a dismissed overlap", () => {
    // Dismissal removes the warning without putting anything back in its
    // place — the same thing the Board lens has always done for other kinds.
    const d = detail({ dismissedConflictIds: ["time-overlap:d1:a:b"] });
    expect([...badgeableConflictSubjects(d, new Set())]).toEqual([]);
  });

  it("does not badge a dismissed conflict of any other kind either", () => {
    // The bug this pins: the dismissal and the rendered-overlap exclusions
    // used to be one `kind !== OVERLAP_KIND || !surfaced(c)` test, so the
    // dismissal half was unreachable for anything but an overlap. Dismissing
    // a distance conflict removed its ConflictBanner row and left the
    // triangle stranded on the card, unexplained and un-dismissable.
    const d = detail({
      conflicts: [
        { id: "impossible-geography:d1:a:b", kind: "impossible-geography", severity: "warn", subjects: ["a", "b"], description: '"Nezu Museum" (Tokyo) and "Lunch at Kagari" (Kanazawa) are ~309 km apart on the same day.', resolutions: [] },
      ],
      dismissedConflictIds: ["impossible-geography:d1:a:b"],
    });
    expect([...badgeableConflictSubjects(d, new Set())]).toEqual([]);
  });

  it("still badges an undismissed conflict of another kind when a sibling overlap is dismissed", () => {
    // The mirror of the case above: dismissal is per conflict id, not a
    // blanket mute for the stop.
    const d = detail({
      conflicts: [
        overlapConflict("time-overlap:d1:a:b", ["a", "b"]),
        { id: "impossible-geography:d1:a:b", kind: "impossible-geography", severity: "warn", subjects: ["a", "b"], description: '"Nezu Museum" (Tokyo) and "Lunch at Kagari" (Kanazawa) are ~309 km apart on the same day.', resolutions: [] },
      ],
      dismissedConflictIds: ["time-overlap:d1:a:b"],
    });
    expect([...badgeableConflictSubjects(d, new Set())].sort()).toEqual(["a", "b"]);
  });
});
