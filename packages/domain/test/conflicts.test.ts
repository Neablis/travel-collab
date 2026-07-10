import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { TimeWindow } from "@tc/contracts";
import {
  detectConflicts,
  GEO_INFEASIBLE_KM,
  haversineKm,
  windowsOverlap,
  type TripState,
} from "../src";

type ActivitySpec = {
  id: string;
  title?: string;
  window?: TimeWindow;
  point?: { name: string; lat: number; lng: number };
};

function boardState(dayActivities: ActivitySpec[], backlogActivities: ActivitySpec[] = []): TripState {
  const all = [...dayActivities, ...backlogActivities];
  return {
    tripId: "trip-1",
    name: "Test",
    members: [{ userId: "user-1", role: "owner" }],
    startDate: null,
    days: [{ dayId: "day-1", activityIds: dayActivities.map((a) => a.id) }],
    backlog: backlogActivities.map((a) => a.id),
    activities: Object.fromEntries(
      all.map((a) => [
        a.id,
        {
          title: a.title ?? a.id,
          timeWindow: a.window ?? null,
          location: a.point ? { name: a.point.name, lat: a.point.lat, lng: a.point.lng } : null,
          notes: null,
          anchors: [],
        },
      ]),
    ),
    dismissedConflictIds: [],
  };
}

const ROME = { name: "Rome", lat: 41.8902, lng: 12.4922 };
const VATICAN = { name: "Vatican", lat: 41.9066, lng: 12.4536 };
const NYC = { name: "New York", lat: 40.7794, lng: -73.9632 };

describe("time-overlap rule", () => {
  it("flags overlapping windows on the same day, subjects sorted", () => {
    const conflicts = detectConflicts(
      boardState([
        { id: "b", window: { start: "09:00", end: "11:00" } },
        { id: "a", window: { start: "10:00", end: "12:00" } },
      ]),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      kind: "time-overlap",
      severity: "warn",
      subjects: ["a", "b"],
    });
    expect(conflicts[0]!.resolutions.length).toBeGreaterThan(0);
  });

  it("does not flag adjacent windows or untimed activities", () => {
    expect(
      detectConflicts(
        boardState([
          { id: "a", window: { start: "09:00", end: "10:00" } },
          { id: "b", window: { start: "10:00", end: "11:00" } },
          { id: "c" },
        ]),
      ),
    ).toEqual([]);
  });

  it("ignores the backlog entirely", () => {
    expect(
      detectConflicts(
        boardState(
          [],
          [
            { id: "a", window: { start: "09:00", end: "11:00" } },
            { id: "b", window: { start: "09:00", end: "11:00" } },
          ],
        ),
      ),
    ).toEqual([]);
  });
});

describe("impossible-geography rule", () => {
  it("flags far-apart located activities on the same day", () => {
    const conflicts = detectConflicts(
      boardState([
        { id: "a", point: ROME },
        { id: "b", point: NYC },
      ]),
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ kind: "impossible-geography", severity: "warn", subjects: ["a", "b"] });
  });

  it("allows nearby activities and unlocated pairs", () => {
    expect(
      detectConflicts(
        boardState([
          { id: "a", point: ROME },
          { id: "b", point: VATICAN },
          { id: "c" },
        ]),
      ),
    ).toEqual([]);
  });

  it("haversine sanity: Rome–NYC is far, Rome–Vatican is near", () => {
    expect(haversineKm(ROME, NYC)).toBeGreaterThan(GEO_INFEASIBLE_KM);
    expect(haversineKm(ROME, VATICAN)).toBeLessThan(10);
  });
});

// ---- property-based tests (guidelines: every rule gets them) ----

const minuteOfDay = fc.integer({ min: 0, max: 24 * 60 - 1 });
const arbWindow = fc
  .tuple(minuteOfDay, minuteOfDay)
  .filter(([a, b]) => a !== b)
  .map(([a, b]) => {
    const [start, end] = a < b ? [a, b] : [b, a];
    const fmt = (m: number) =>
      `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    return { start: fmt(start), end: fmt(end) };
  });

const arbPoint = fc.record({
  name: fc.constant("Somewhere"),
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
});

describe("conflict engine properties", () => {
  it("windowsOverlap is symmetric", () => {
    fc.assert(
      fc.property(arbWindow, arbWindow, (a, b) => windowsOverlap(a, b) === windowsOverlap(b, a)),
    );
  });

  it("haversine is symmetric, non-negative, zero on identity", () => {
    fc.assert(
      fc.property(arbPoint, arbPoint, (a, b) => {
        const d1 = haversineKm(a, b);
        const d2 = haversineKm(b, a);
        return d1 >= 0 && Math.abs(d1 - d2) < 1e-6 && haversineKm(a, a) < 1e-6;
      }),
    );
  });

  it("conflicts always pair two distinct, sorted subjects — never self-conflicts", () => {
    fc.assert(
      fc.property(fc.array(arbWindow, { maxLength: 6 }), (windows) => {
        const state = boardState(windows.map((window, i) => ({ id: `a${i}`, window })));
        return detectConflicts(state).every(
          (c) => c.subjects.length === 2 && c.subjects[0]! < c.subjects[1]!,
        );
      }),
    );
  });

  it("conflict ids are invariant under activity insertion order", () => {
    fc.assert(
      fc.property(fc.array(arbWindow, { maxLength: 6 }), (windows) => {
        const specs = windows.map((window, i) => ({ id: `a${i}`, window }));
        const ids = (s: TripState) => detectConflicts(s).map((c) => c.id);
        return (
          JSON.stringify(ids(boardState(specs))) ===
          JSON.stringify(ids(boardState([...specs].reverse())))
        );
      }),
    );
  });
});
