import { describe, expect, it } from "vitest";
import { JAPAN_SAVED_DAYS } from "./japan/savedDays.ts";
import { STARTER_SAVED_DAYS } from "./library/starterDays.ts";
import { MIN_POINTS_TO_DRAW } from "@tc/contracts";

// **The seeded Playbook library has to be able to DRAW.**
//
// SPEC §16 — "a shared day is a map plus a list" — and M26 built
// `SharedDayMap` for it. Walking the preview on 2026-09-20 found three
// different shared days rendering **zero** map canvases, and the component was
// not at fault: `worthDrawing` needs two stops with coordinates, and until that
// day **not one stop in either seeded fixture carried a `lat` at all.** Both
// `stop()` helpers built `location` as `{ name, city }` and dropped the rest.
//
// So the map half of §16 was unreachable on every seeded database, including
// the one anybody gets from `pnpm --filter web db:reseed`, and nothing said so:
// every unit test passed, because each one supplies its own located fixture,
// and the degrade-to-list-only path renders no error. This file is the thing
// that would have caught it — an assertion about the CONTENT, not the code.
//
// It deliberately asserts both halves of M26's gate box, because a library that
// could only draw would be the same blind spot facing the other way.
//
// `MIN_POINTS_TO_DRAW` is imported from `@tc/contracts`, which both this
// package and `apps/web` depend on. It used to be a local `2` with a comment
// claiming a private copy was "wrong in the safe direction" if the app's
// threshold moved. That was backwards: raise the app to 3 and this file still
// counts two-point days as drawable, so the assertion stays green while no
// seeded day draws — the precise failure it exists to prevent (CodeRabbit,
// PR #196).

type SeedStop = { location: { lat?: number; lng?: number } | null };
type SeedDay = { name: string; stops: readonly SeedStop[] };

function locatedStops(day: SeedDay): number {
  return day.stops.filter(
    // `Number.isFinite`, not `typeof === "number"`: `typeof NaN` is `"number"`.
    (s) => s.location !== null && Number.isFinite(s.location.lat) && Number.isFinite(s.location.lng),
  ).length;
}

const SEEDED_LIBRARY: readonly SeedDay[] = [...JAPAN_SAVED_DAYS, ...STARTER_SAVED_DAYS];

describe("the seeded Playbook library, as a map draws it", () => {
  it("has at least one day whose map draws", () => {
    const drawable = SEEDED_LIBRARY.filter((d) => locatedStops(d) >= MIN_POINTS_TO_DRAW).map((d) => d.name);
    // The names, not a count: when this goes red the question is always "which
    // day was I supposed to be looking at", and a bare `0` cannot answer it.
    expect(drawable).not.toEqual([]);
  });

  // The other half of M26's gate box, and it is seeded DELIBERATELY rather
  // than by everything else happening to be unlocated — which is why this
  // names the day and its exact count instead of asserting "some day has
  // fewer than two". The latter is true today for eight days by accident and
  // would stay green through any change; this goes red if the coordinate is
  // removed (0) or if a second is added to the same day (2), which are the two
  // ways the seeded degrade case can stop existing.
  it("keeps one day at exactly one located stop, which is the list-only case", () => {
    const osaka = SEEDED_LIBRARY.find((d) => d.name === "Kyoto, then an evening in Osaka");
    expect(osaka).toBeDefined();
    expect(locatedStops(osaka!)).toBe(1);
  });

  it("puts every coordinate it does carry on a real point", () => {
    const offenders: string[] = [];
    for (const day of SEEDED_LIBRARY) {
      for (const stop of day.stops) {
        const loc = stop.location;
        if (loc === null) continue;
        const hasLat = typeof loc.lat === "number";
        const hasLng = typeof loc.lng === "number";
        // Half a coordinate is worse than none: `allPoints` reads both, so a
        // lone `lat` is a stop that looks located and is not.
        if (hasLat !== hasLng) offenders.push(`${day.name}: lat=${loc.lat} lng=${loc.lng}`);
        // `hasLat`/`hasLng` stay `typeof` checks above, deliberately: a present
        // but non-finite `lat` is still PRESENT, so it belongs to this branch
        // rather than the half-a-coordinate one. Here is where it is rejected —
        // `Math.abs(NaN) > 90` is `false`, so the range test alone waved NaN
        // through (CodeRabbit, PR #196).
        else if (
          hasLat &&
          hasLng &&
          (!Number.isFinite(loc.lat) ||
            !Number.isFinite(loc.lng) ||
            Math.abs(loc.lat!) > 90 ||
            Math.abs(loc.lng!) > 180)
        ) {
          offenders.push(`${day.name}: not a real point at ${loc.lat},${loc.lng}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
