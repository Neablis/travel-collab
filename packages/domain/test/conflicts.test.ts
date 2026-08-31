import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { ActivityKind, TimeWindow } from "@tc/contracts";
import { witness } from "./support/witness";
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
  kind?: ActivityKind;
};

function boardState(dayActivities: ActivitySpec[], backlogActivities: ActivitySpec[] = []): TripState {
  const all = [...dayActivities, ...backlogActivities];
  return {
    tripId: "trip-1",
    name: "Test",
    members: [{ userId: "user-1", role: "owner" }],
    forkedFrom: null,
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
          kind: a.kind ?? ("planned" as const),
          tags: [],
          cost: null,
        },
      ]),
    ),
    dismissedConflictIds: [],
    currency: "USD",
    budget: null,
    status: "active",
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

  // KI-60. A travel day is not a mistake. Every case below was a false
  // conflict before the transit exclusion, and the "still flags" ones are the
  // boundary that keeps it from excusing everything.
  describe("a transit stop excuses the distance it crosses (KI-60)", () => {
    const geo = (state: TripState) =>
      detectConflicts(state).filter((c) => c.kind === "impossible-geography");

    it("excuses a pair a transit stop sits BETWEEN in time", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", point: ROME, window: { start: "10:00", end: "14:00" }, kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toEqual([]);
    });

    it("excuses a pair when the transit stop IS one of them — it is what moves you", () => {
      expect(
        geo(
          boardState([
            { id: "t", point: ROME, window: { start: "08:00", end: "14:00" }, kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toEqual([]);
    });

    it("still flags when the transit stop is OUTSIDE the interval", () => {
      // Travel at 20:00 cannot explain being in Rome at 08:00 and NYC at 10:00.
      const conflicts = geo(
        boardState([
          { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
          { id: "b", point: NYC, window: { start: "10:00", end: "11:00" } },
          { id: "t", point: NYC, window: { start: "20:00", end: "22:00" }, kind: "transit" },
        ]),
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.subjects).toEqual(["a", "b"]);
    });

    it("still flags an untimed stop — 'when' is unknown, so travel cannot cover it", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME },
            { id: "t", point: ROME, window: { start: "10:00", end: "14:00" }, kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toHaveLength(1);
    });

    // `t` carries no point in this test and the next, so it forms no far-apart
    // pair of its own — the only conflict available is a<->b, which is exactly
    // the question being asked.
    it("ignores an untimed transit stop — it cannot be placed in the interval", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toHaveLength(1);
    });

    it("is transit-only — no other kind excuses a distance", () => {
      for (const kind of ["planned", "booked", "hold", "idea"] as const) {
        expect(
          geo(
            boardState([
              { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
              { id: "t", window: { start: "10:00", end: "14:00" }, kind },
              { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
            ]),
          ),
          `kind ${kind} must not excuse a distance`,
        ).toHaveLength(1);
      }
    });

    it("does not touch time-overlap conflicts on the same day", () => {
      const conflicts = detectConflicts(
        boardState([
          { id: "t", point: ROME, window: { start: "08:00", end: "14:00" }, kind: "transit" },
          { id: "a", point: NYC, window: { start: "18:00", end: "20:00" } },
          { id: "b", point: NYC, window: { start: "19:00", end: "21:00" } },
        ]),
      );
      expect(conflicts.map((c) => c.kind)).toEqual(["time-overlap"]);
    });
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
    const w = witness("windowsOverlap symmetry");
    fc.assert(
      fc.property(arbWindow, arbWindow, (a, b) => {
        w.tick();
        return windowsOverlap(a, b) === windowsOverlap(b, a);
      }),
    );
    w.atLeast(100); // exactly numRuns; no guard clause
  });

  it("haversine is symmetric, non-negative, zero on identity", () => {
    const w = witness("haversine metric laws");
    fc.assert(
      fc.property(arbPoint, arbPoint, (a, b) => {
        w.tick();
        const d1 = haversineKm(a, b);
        const d2 = haversineKm(b, a);
        return d1 >= 0 && Math.abs(d1 - d2) < 1e-6 && haversineKm(a, a) < 1e-6;
      }),
    );
    w.atLeast(100); // exactly numRuns; no guard clause
  });

  it("conflicts always pair two distinct, sorted subjects — never self-conflicts", () => {
    // Ticks per conflict *examined*, not per run: `.every` on an empty array is
    // vacuously true, so a generator that stopped producing overlaps would keep
    // this green while checking nothing. The floor counts real conflicts.
    const w = witness("conflict subject pairing");
    fc.assert(
      fc.property(fc.array(arbWindow, { maxLength: 6 }), (windows) => {
        const state = boardState(windows.map((window, i) => ({ id: `a${i}`, window })));
        return detectConflicts(state).every((c) => {
          w.tick();
          return c.subjects.length === 2 && c.subjects[0]! < c.subjects[1]!;
        });
      }),
    );
    w.atLeast(130); // observed 266-334 conflicts examined
  });

  it("conflict ids are invariant under activity insertion order", () => {
    // Ticks only when the forward pass actually found a conflict. Both sides
    // empty makes this `"[]" === "[]"` — true, and proving nothing about order
    // invariance. The floor counts the runs where the comparison had content.
    const w = witness("conflict id order-invariance");
    fc.assert(
      fc.property(fc.array(arbWindow, { maxLength: 6 }), (windows) => {
        const specs = windows.map((window, i) => ({ id: `a${i}`, window }));
        const ids = (s: TripState) => detectConflicts(s).map((c) => c.id);
        const forward = ids(boardState(specs));
        if (forward.length > 0) w.tick();
        return JSON.stringify(forward) === JSON.stringify(ids(boardState([...specs].reverse())));
      }),
    );
    w.atLeast(24); // observed 49-64 non-empty comparisons
  });
});
