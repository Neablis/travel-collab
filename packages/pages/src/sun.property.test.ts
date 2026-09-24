// The order claim `sunEvents` makes for every ordinary place and day: the sun
// rises, climbs past six degrees, comes back down past them, and sets — in that
// order, within one day. Ordinary means within 60° of the equator, where every
// day of the year has all four (at 60° on the December solstice the noon sun
// still reaches 6.56°), so no case is skipped and the floor is exact.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
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
});
