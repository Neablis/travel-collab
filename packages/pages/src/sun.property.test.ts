// The order claim `sunEvents` makes for every ordinary place and day: the sun
// rises, climbs past six degrees, comes back down past them, and sets — in that
// order, within one day. Ordinary means within 60° of the equator, where every
// day of the year has all four (at 60° on the December solstice the noon sun
// still reaches 6.56°), so no case is skipped and the floor is exact.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clockIn } from "./clock";
import { sunEvents } from "./sun";
import { witness } from "./test-support/witness";

const RUNS = 300;
const dateArb = fc
  .date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2035, 11, 31)), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

describe("sunEvents properties", () => {
  it("rises, turns golden, turns golden again and sets, in that order, within a day", () => {
    const w = witness("sun order");
    fc.assert(
      fc.property(
        dateArb,
        fc.double({ min: -60, max: 60, noNaN: true }),
        fc.double({ min: -180, max: 180, noNaN: true }),
        (date, lat, lng) => {
          const sun = sunEvents(date, lat, lng);
          const times = [sun.sunrise, sun.goldenMorningEnd, sun.goldenEveningStart, sun.sunset];
          expect(times.every((t) => typeof t === "number"), JSON.stringify(times)).toBe(true);
          const [rise, goldenEnd, goldenStart, set] = times as number[];
          expect(rise).toBeLessThan(goldenEnd!);
          expect(goldenEnd).toBeLessThan(goldenStart!);
          expect(goldenStart).toBeLessThan(set!);
          expect(set! - rise!).toBeLessThan(24 * 3_600_000);
          w.tick();
        },
      ),
      { numRuns: RUNS },
    );
    // No guard clause: every run asserts, so the floor is exact.
    w.atLeast(RUNS);
  });

  // A place near a city, in that city's zone: the zone has to be the one the
  // place actually keeps, or "local date" means nothing. The list leans on the
  // zones far from their meridian — west of 180° on the Asian side of the date
  // line (Apia, Tonga, Kiritimati, Chatham), and Kashgar on Beijing's clock.
  const ZONED: readonly [zone: string, lat: number, lng: number][] = [
    ["Pacific/Apia", -13.83, -171.77],
    ["Pacific/Tongatapu", -21.14, -175.2],
    ["Pacific/Kiritimati", 1.87, -157.43],
    ["Pacific/Chatham", -43.95, -176.56],
    ["Pacific/Auckland", -36.85, 174.76],
    ["Pacific/Honolulu", 21.31, -157.86],
    ["America/Los_Angeles", 34.05, -118.24],
    ["Europe/London", 51.51, -0.13],
    ["Asia/Kolkata", 28.61, 77.21],
    ["Asia/Shanghai", 39.47, 75.99],
    ["Asia/Tokyo", 35.68, 139.77],
  ];
  const zonedPlace = fc
    .tuple(fc.constantFrom(...ZONED), fc.double({ min: -2, max: 2, noNaN: true }), fc.double({ min: -2, max: 2, noNaN: true }))
    .map(([[zone, lat, lng], dLat, dLng]) => ({ zone, lat: lat + dLat, lng: lng + dLng }));

  it("the sunrise for a date falls on that date, on the place's own clock", () => {
    const w = witness("sunrise local date");
    fc.assert(
      fc.property(dateArb, zonedPlace, (date, { zone, lat, lng }) => {
        const { sunrise } = sunEvents(date, lat, lng, zone);
        // Every place listed is within 60° of the equator, so the sun rises on
        // every date — no guard, and a non-number is a failure, not a skip.
        expect(typeof sunrise, `${zone} ${date}`).toBe("number");
        expect(clockIn(zone, sunrise as number).date, `${zone} ${date}`).toBe(date);
        w.tick();
      }),
      { numRuns: RUNS },
    );
    w.atLeast(RUNS);
  });
});
