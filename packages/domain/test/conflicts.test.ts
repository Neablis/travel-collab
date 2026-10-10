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
          pendingReason: null,
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

  // Mitchell's feedback #8, decided 2026-10-10: "Pending events shouldn't be an
  // overlap till they are no longer pending." A pending stop (Maybe / To book,
  // ADR-055) is not a commitment, so a stop on top of it is no conflict at all.
  it("does not flag an overlap while either stop is pending", () => {
    expect(
      detectConflicts(
        boardState([
          { id: "a", window: { start: "09:00", end: "11:00" }, kind: "pending" },
          { id: "b", window: { start: "10:00", end: "12:00" } },
        ]),
      ),
    ).toEqual([]);
    expect(
      detectConflicts(
        boardState([
          { id: "a", window: { start: "09:00", end: "11:00" } },
          { id: "b", window: { start: "10:00", end: "12:00" }, kind: "pending" },
        ]),
      ),
    ).toEqual([]);
  });

  it("still flags a pending stop's neighbours against each other", () => {
    const conflicts = detectConflicts(
      boardState([
        { id: "a", window: { start: "09:00", end: "11:00" } },
        { id: "b", window: { start: "10:00", end: "12:00" } },
        { id: "p", window: { start: "09:30", end: "11:30" }, kind: "pending" },
      ]),
    );
    expect(conflicts.map((c) => c.subjects)).toEqual([["a", "b"]]);
  });

  it("flags a transit stop's overlap like a planned one's", () => {
    const conflicts = detectConflicts(
      boardState([
        { id: "a", window: { start: "09:00", end: "11:00" }, kind: "transit" },
        { id: "b", window: { start: "10:00", end: "12:00" } },
      ]),
    );
    expect(conflicts.map((c) => c.kind)).toEqual(["time-overlap"]);
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

  // Mitchell, 2026-09-30 (option "B"): ANY transit stop on a day excuses every
  // distance on that day — timed or not, located or not, wherever it goes. A
  // day without one is checked exactly as before. History: KI-60 (resolved)
  // excused only a pair a timed transit stop sat between in time; M24 then
  // required its destination to agree; 2026-09-21 dropped the transit stop from
  // pairing. An API user's untimed stops fell through all three, so every
  // travel day still flagged.
  describe("a transit stop on the day excuses every distance on it (Mitchell, 2026-09-30)", () => {
    const geo = (state: TripState) =>
      detectConflicts(state).filter((c) => c.kind === "impossible-geography");
    const TOKYO = { name: "Tokyo", lat: 35.6812, lng: 139.7671 };

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

    // Was "still flags when the transit stop is OUTSIDE the interval" (KI-60).
    // Where on the day the travel falls no longer matters.
    it("excuses a pair even when the transit stop is OUTSIDE its interval", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "b", point: NYC, window: { start: "10:00", end: "11:00" } },
            { id: "t", point: NYC, window: { start: "20:00", end: "22:00" }, kind: "transit" },
          ]),
        ),
      ).toEqual([]);
    });

    // Was "still flags an untimed stop" (KI-60). The API user's shape.
    it("excuses untimed paired stops", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME },
            { id: "t", point: ROME, window: { start: "10:00", end: "14:00" }, kind: "transit" },
            { id: "b", point: NYC },
          ]),
        ),
      ).toEqual([]);
    });

    // Was "ignores an untimed transit stop" (KI-60) and "keeps KI-60's floor"
    // (M24). `t` has no time window and no point: its presence alone excuses.
    it("excuses when the transit stop itself is untimed and unlocated", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toEqual([]);
    });

    // Was "flags the pair when the destination is somewhere else" (M24). The
    // destination is no longer consulted.
    it("excuses even when the transit stop's endLocation is far from both stops", () => {
      expect(
        geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", point: ROME, end: TOKYO, window: { start: "10:00", end: "14:00" }, kind: "transit" },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        ),
      ).toEqual([]);
    });

    it("is transit-only — no other kind excuses a distance", () => {
      for (const kind of ["planned", "pending"] as const) {
        const conflicts = geo(
          boardState([
            { id: "a", point: ROME, window: { start: "08:00", end: "09:00" } },
            { id: "t", window: { start: "10:00", end: "14:00" }, kind },
            { id: "b", point: NYC, window: { start: "18:00", end: "19:00" } },
          ]),
        );
        expect(conflicts, `kind ${kind} must not excuse a distance`).toHaveLength(1);
        expect(conflicts[0]!.subjects).toEqual(["a", "b"]);
      }
    });

    // The excuse is per DAY, not per trip: a train on day 2 says nothing about
    // Rome and New York both being on day 1.
    it("still flags a day with no transit, even when another day has one", () => {
      const state = boardState([
        { id: "a", point: ROME },
        { id: "b", point: NYC },
        { id: "t", kind: "transit" },
        { id: "c", point: ROME },
        { id: "d", point: TOKYO },
      ]);
      state.days = [
        { dayId: "day-1", activityIds: ["a", "b"] },
        { dayId: "day-2", activityIds: ["t", "c", "d"] },
      ];
      const conflicts = geo(state);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]).toMatchObject({ id: "impossible-geography:day-1:a:b", subjects: ["a", "b"] });
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

  // Mitchell, 2026-09-21, on a real Portugal trip: "Train: Lisbon to Porto"
  // (untimed) flagged against a timed Porto stop at ~273 km. Kept as the
  // concrete regression case; the 2026-09-30 rule covers it as a special case.
  describe("the Lisbon -> Porto train day", () => {
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

  // The 2026-09-30 rule's two halves, for ALL generated days. `arbStop` mixes
  // timed/untimed, located/not, transit/not and endLocations, so none of the
  // old rule's nuances can decide the outcome unnoticed.
  const geoConflicts = (s: TripState) => detectConflicts(s).filter((c) => c.kind === "impossible-geography");
  const arbStop = fc.record({
    window: fc.option(arbWindow, { nil: undefined }),
    point: fc.option(arbPoint, { nil: undefined, freq: 4 }),
    transit: fc.boolean(),
    end: fc.option(arbPoint, { nil: undefined }),
  });
  type Stop = { window?: TimeWindow; point?: ActivitySpec["point"]; transit: boolean; end?: ActivitySpec["point"] };
  const toSpecs = (stops: Stop[]) =>
    stops.map(
      (s, i): ActivitySpec => ({
        id: `a${i}`,
        window: s.window,
        point: s.point,
        ...(s.transit ? { kind: "transit" as const, end: s.end } : {}),
      }),
    );

  it("a day with any transit stop raises no impossible-geography conflict", () => {
    // Ticks only when the SAME day with its transit stops recast as planned
    // WOULD flag — i.e. when the transit stop is what excused something.
    const w = witness("transit excuses the day");
    fc.assert(
      fc.property(fc.array(arbStop, { minLength: 2, maxLength: 7 }), (stops) => {
        const specs = toSpecs(stops);
        if (!specs.some((s) => s.kind === "transit")) return true;
        const recast = specs.map((s) => ({ ...s, kind: undefined, end: undefined }));
        if (geoConflicts(boardState(recast)).length > 0) w.tick();
        return geoConflicts(boardState(specs)).length === 0;
      }),
      { numRuns: 300 },
    );
    w.atLeast(17); // observed 35-52 excusing days in 300 runs over 15 runs
  });

  it("a day with no transit stop flags exactly the located pairs over GEO_INFEASIBLE_KM", () => {
    // Independent oracle: count far pairs directly. Ticks per day that has one.
    const w = witness("no transit flags every far pair");
    fc.assert(
      fc.property(fc.array(arbStop, { minLength: 2, maxLength: 7 }), (stops) => {
        const specs = toSpecs(stops.map((s) => ({ ...s, transit: false })));
        const located = specs.flatMap((s) => (s.point ? [s.point] : []));
        let far = 0;
        for (let i = 0; i < located.length; i++)
          for (let j = i + 1; j < located.length; j++)
            if (haversineKm(located[i]!, located[j]!) > GEO_INFEASIBLE_KM) far++;
        if (far > 0) w.tick();
        return geoConflicts(boardState(specs)).length === far;
      }),
      { numRuns: 300 },
    );
    w.atLeast(17); // observed 35-58 days with a far pair in 300 runs over 15 runs
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
