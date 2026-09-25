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
  // M24: a transit stop's destination. `lat`/`lng` optional because a stored
  // Location may carry neither.
  end?: { name: string; lat?: number; lng?: number };
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
          bookedBy: null,
          participants: [],
          mode: null,
          endLocation: a.end ?? null,
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

    // COVERAGE NOTE, 2026-09-21. The test directly above used to be what
    // exercised `transitExcusesDistance`'s `>= lo` boundary (rather than
    // `> lo`): `t` was a pair member, so the pair formed and was excused by a
    // transit start EQUAL to the interval's low end. Since a transit stop is
    // no longer a pair member at all, that test now passes because no pair
    // forms, and the boundary lost its only witness. This is that witness,
    // rebuilt out of stops the exclusion does not touch: the non-transit `a`
    // starts at 10:00 and so does the transit stop, so `>= lo` excuses the
    // a<->b pair and `> lo` would not.
    it("excuses a pair whose earlier stop starts at the same time as the travel", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "10:00", end: "11:00" } },
            { id: "t", point: ROME, window: { start: "10:00", end: "14:00" }, kind: "transit" },
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
      for (const kind of ["planned", "pending"] as const) {
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

  // M24 link 4. With an `endLocation` the engine can ask what KI-60 could
  // not: does the travel go to the right place? A timed transit stop in the
  // interval now excuses a far-apart pair only if its destination is within
  // GEO_INFEASIBLE_KM of the pair's LATER stop. A transit stop with no
  // destination is exactly KI-60's rule, unchanged.
  describe("a transit stop's destination must agree with where the day goes next (M24)", () => {
    const geo = (state: TripState) =>
      detectConflicts(state).filter((c) => c.kind === "impossible-geography");
    // ~5 km from NYC: "near" by the rule's own threshold, not a copy of NYC.
    const JFK_ISH = { name: "Queens", lat: 40.7282, lng: -73.7949 };
    const TOKYO = { name: "Tokyo", lat: 35.6812, lng: 139.7671 };

    it("excuses the pair when the destination is near the later stop", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", point: ROME, end: JFK_ISH, window: { start: "10:00", end: "14:00" }, kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toEqual([]);
    });

    it("flags the pair when the destination is somewhere else — travel to Tokyo does not put you in New York", () => {
      const conflicts = geo(
        boardState([
          { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
          { id: "t", point: ROME, end: TOKYO, window: { start: "10:00", end: "14:00" }, kind: "transit" },
          { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
        ]),
      );
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.subjects).toEqual(["a", "b"]);
    });

    // "Later" is TIME order (KI-60 property 1): `b` is stored first here, so a
    // rule that took the second-stored stop as "later" would compare Queens
    // with Rome and flag.
    it("reads the later stop by time, not by stored order", () => {
      expect(
        geo(
          boardState([
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
            { id: "t", point: ROME, end: JFK_ISH, window: { start: "10:00", end: "14:00" }, kind: "transit" },
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
          ]),
        ),
      ).toEqual([]);
    });

    it("with no endLocation, behaves exactly as KI-60 — any timed travel in the interval excuses", () => {
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

    // An endLocation that was never geocoded names a place but not where it
    // is. That is absence of evidence, not disagreement, so it falls back to
    // the no-destination rule rather than flagging.
    it("treats a destination without coordinates as no destination", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", point: ROME, end: { name: "Somewhere in New York" }, window: { start: "10:00", end: "14:00" }, kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toEqual([]);
    });

    it("keeps KI-60's floor — a destination does not make an untimed transit stop excuse anything", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", end: JFK_ISH, kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toHaveLength(1);
    });
  });

  // Mitchell, 2026-09-21, on a real Portugal trip. A transit stop's coordinate
  // is where the journey STARTS, so its distance to anything else on the day
  // says nothing about whether the day is possible — it is never a member of a
  // pair at all.
  //
  // Sibling of the KI-60 block above, not a replacement for it: that rule
  // excuses a pair of NON-transit stops that travel sits between in time, and
  // it needs BOTH of them timed to do it. Every case here is one it could not
  // reach for exactly that reason.
  describe("a transit stop is never a member of a distance pair", () => {
    const geo = (state: TripState) =>
      detectConflicts(state).filter((c) => c.kind === "impossible-geography");

    const SANTA_APOLONIA = { name: "Lisboa Santa Apolónia", lat: 38.7139, lng: -9.1223 };
    const RIBEIRA = { name: "Ribeira", lat: 41.1408, lng: -8.6132 };

    it("haversine sanity: Santa Apolónia–Ribeira is the ~273 km Mitchell reported", () => {
      const km = haversineKm(SANTA_APOLONIA, RIBEIRA);
      expect(km).toBeGreaterThan(270);
      expect(km).toBeLessThan(276);
    });

    it("does not flag 'Train: Lisbon to Porto' against a Porto stop", () => {
      // The exact shape that was firing: the train carries no time window and
      // the other stop does, so transitExcusesDistance — which returns false
      // unless both have a `start` — could never excuse the pair.
      expect(
        geo(
          boardState([
            { id: "train", title: "Train: Lisbon to Porto", point: SANTA_APOLONIA, kind: "transit" },
            {
              id: "ribeira",
              title: "Ribeira and the Dom Luís I bridge",
              point: RIBEIRA,
              window: { start: "15:00", end: "18:00" },
            },
          ]),
        ),
      ).toEqual([]);
    });

    it("excuses the pair when NEITHER stop is timed", () => {
      expect(
        geo(
          boardState([
            { id: "train", point: SANTA_APOLONIA, kind: "transit" },
            { id: "ribeira", point: RIBEIRA },
          ]),
        ),
      ).toEqual([]);
    });

    it("is transit-only — the same untimed pair still flags for every other kind", () => {
      for (const kind of ["planned", "pending"] as const) {
        expect(
          geo(
            boardState([
              { id: "train", point: SANTA_APOLONIA, kind },
              { id: "ribeira", point: RIBEIRA },
            ]),
          ),
          `kind ${kind} must still be subject to the distance check`,
        ).toHaveLength(1);
      }
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

  // M24 link 4's two "for ALL" claims. Each witness ticks only when today's
  // (KI-60) rule actually excused something in the generated day, found by
  // diffing against the same day with every transit stop untimed (an untimed
  // transit stop excuses nothing and is never a pair member). A day where
  // nothing was excused compares two equal lists and proves nothing.
  const geoIds = (s: TripState) =>
    detectConflicts(s).filter((c) => c.kind === "impossible-geography").map((c) => c.id);
  const excusedByTravel = (specs: ActivitySpec[]) => {
    const untimed = specs.map((a) => (a.kind === "transit" ? { ...a, window: undefined } : a));
    return geoIds(boardState(untimed)).length > geoIds(boardState(specs.map((a) => ({ ...a, end: undefined })))).length;
  };

  it("a destination only ever narrows the excuse — it never clears a conflict KI-60 raised", () => {
    const w = witness("destination narrows");
    const arbStop = fc.record({
      // Mostly timed: an untimed stop can neither be excused nor excuse, so a
      // generator at 50% untimed spent most runs on days with nothing at stake.
      window: fc.option(arbWindow, { nil: undefined, freq: 8 }),
      point: arbPoint,
      transit: fc.boolean(),
      end: fc.option(arbPoint, { nil: undefined }),
    });
    fc.assert(
      fc.property(fc.array(arbStop, { minLength: 4, maxLength: 8 }), (stops) => {
        const specs: ActivitySpec[] = stops.map((s, i) => ({
          id: `a${i}`,
          window: s.window,
          point: s.point,
          ...(s.transit ? { kind: "transit" as const, end: s.end } : {}),
        }));
        if (excusedByTravel(specs)) w.tick();
        const today = geoIds(boardState(specs.map((a) => ({ ...a, end: undefined }))));
        const withDestinations = new Set(geoIds(boardState(specs)));
        return today.every((id) => withDestinations.has(id));
      }),
      { numRuns: 300 },
    );
    w.atLeast(7); // observed 15-30 excusing days in 300 runs over 15 runs
  });

  it("a destination at the later stop changes nothing — every pair excused today is still excused", () => {
    const w = witness("agreeing destination");
    fc.assert(
      fc.property(arbWindow, arbWindow, arbWindow, arbPoint, arbPoint, arbPoint, (wa, wb, wt, pa, pb, pt) => {
        const later = wa.start < wb.start ? pb : wb.start < wa.start ? pa : pa;
        const specs: ActivitySpec[] = [
          { id: "a", window: wa, point: pa },
          { id: "t", window: wt, point: pt, kind: "transit", end: later },
          { id: "b", window: wb, point: pb },
        ];
        if (excusedByTravel(specs)) w.tick();
        const today = geoIds(boardState(specs.map((a) => ({ ...a, end: undefined }))));
        return JSON.stringify(geoIds(boardState(specs))) === JSON.stringify(today);
      }),
      { numRuns: 300 },
    );
    w.atLeast(13); // observed 26-47 excusing days in 300 runs over 15 runs
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
