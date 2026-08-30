// A stop's `city` has to agree with its `lat`/`lng`. This is the guard that
// KI-59 did not have.
//
// KI-59 was seven stops tagged with a city they were not in, because `city`
// was the containing DAY's destination and a travel day's destination is not
// where the day starts. Nothing failed — the drift test was happy (the values
// matched upstream exactly), the conflict engine reads coordinates and never
// looked, and the wrong city was only visible if you read `Location.name` and
// happened to know Japanese geography. It took a live LocationIQ run sending
// "Shinjuku Station, Shinjuku, Hakone" to surface it.
//
// The check is deliberately coordinate-based rather than a hand-written list
// of the seven: a list only re-states the answer, where this catches the CLASS
// — any future stop whose label disagrees with where it actually is.
//
// Method: each city's stops give it a centroid, and no stop may sit closer to
// a different city's centroid than to its own. That needs no external
// geography, only the coordinates already in the fixture, which
// `coordinateOverrides.ts` and `verify.ts` guard independently.
//
// What it does NOT catch, stated so nobody trusts it further than it goes: a
// mis-tag between two places that are close together. Run against the
// pre-KI-59 data it flags six of the seven; `d13-s1-train-and-ferry-to-
// naoshima` (Uno Port, then tagged Naoshima) survives it, because the port is
// 5km of water from the island and there is no nearer cluster. A city with a
// single stop is also its own centroid, so it can never fail — Odawara and
// Tamano are checked only in the direction of other cities' stops drifting
// into them.

import { describe, expect, it } from "vitest";
import { JAPAN_STOPS } from "./trip.ts";

/** Great-circle km. Same formula as the domain's geography rule. */
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

describe("every stop's city agrees with its coordinates", () => {
  it("puts no stop nearer another city's stops than its own", () => {
    const byCity = new Map<string, { lat: number; lng: number }[]>();
    for (const stop of JAPAN_STOPS) {
      const points = byCity.get(stop.city) ?? [];
      points.push({ lat: stop.lat, lng: stop.lng });
      byCity.set(stop.city, points);
    }
    const centroids = new Map(
      [...byCity].map(([city, points]) => [
        city,
        {
          lat: points.reduce((a, p) => a + p.lat, 0) / points.length,
          lng: points.reduce((a, p) => a + p.lng, 0) / points.length,
        },
      ]),
    );

    // Every mismatch at once rather than the first: a bad re-sync moves several
    // rows together, and "which rows" is the whole answer.
    const findings: string[] = [];
    for (const stop of JAPAN_STOPS) {
      const own = km(stop, centroids.get(stop.city)!);
      for (const [city, centroid] of centroids) {
        if (city === stop.city) continue;
        const other = km(stop, centroid);
        if (other < own) {
          findings.push(
            `${stop.id} ("${stop.title}" at ${stop.place}) is tagged ${stop.city}, ` +
              `but sits ${other.toFixed(0)}km from ${city}'s stops and ${own.toFixed(0)}km from ${stop.city}'s. ` +
              `If the tag is right and the coordinates are wrong, fix the coordinates; if the stop really is ` +
              `somewhere its day is not, record it in ./cityOverrides.ts.`,
          );
        }
      }
    }
    expect(findings).toEqual([]);
  });

  // The centroid rule above has a structural blind spot, and it is exactly
  // where this change is most fragile: **a city with one stop is always zero
  // km from its own centroid**, so no other city can ever be nearer and the
  // rule cannot fire. CodeRabbit found this on PR #97 for Tamano; checking the
  // distribution showed it applies to Odawara too — both cities KI-59
  // introduced, and both the ones a future editor is most likely to "simplify"
  // back into Hakone and Naoshima.
  //
  // These assertions are deliberately hardcoded rather than read from
  // CITY_OVERRIDES. Reading the override map would make the test agree with
  // whatever that map says, which is the vacuous shape the repo's `witness`
  // convention exists to prevent — the point is to fail when someone edits
  // the map.
  const SINGLE_STOP_CITY_CORRECTIONS: ReadonlyArray<readonly [string, string]> = [
    ["d7-s1-shinkansen-odawara-kyoto", "Odawara"],
    ["d13-s1-train-and-ferry-to-naoshima", "Tamano"],
  ];

  it.each(SINGLE_STOP_CITY_CORRECTIONS)(
    "%s is tagged %s, which the centroid rule cannot check",
    (id, city) => {
      const stop = JAPAN_STOPS.find((s) => s.id === id);
      expect(stop, `${id} no longer exists — update this table`).toBeDefined();
      expect(stop!.city).toBe(city);
    },
  );

  // And the blind spot must not be allowed to grow silently: any city that
  // drops to a single stop in future is equally uncheckable by the rule above,
  // so it has to appear in the table too. This is what stops the guard from
  // quietly covering less than it claims.
  it("every single-stop city has a direct assertion above", () => {
    const perCity = new Map<string, string[]>();
    for (const stop of JAPAN_STOPS) {
      perCity.set(stop.city, [...(perCity.get(stop.city) ?? []), stop.id]);
    }
    const singles = [...perCity.entries()].filter(([, ids]) => ids.length === 1);
    const covered = new Set(SINGLE_STOP_CITY_CORRECTIONS.map(([id]) => id));
    const uncovered = singles
      .filter(([, ids]) => !covered.has(ids[0]!))
      .map(([city, ids]) => `${city} has only ${ids[0]}, which no direct assertion pins`);
    expect(uncovered).toEqual([]);
  });
});

