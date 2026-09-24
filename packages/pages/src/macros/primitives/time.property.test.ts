// `day.fromHome`'s claim for every pair of zones and every day: the number it
// prints is what two wall clocks, one in each zone, show apart at that day's
// noon — and the words say which way. Checked against the clocks themselves
// (`clockIn`), not against the offset arithmetic the widget uses, so a sign
// slip or a half-hour truncation in that arithmetic cannot agree with itself.
//
// The zones are chosen for their awkward cases: half- and quarter-hour offsets,
// both hemispheres' daylight saving, the date line, and one zone with none.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { clockIn } from "../../clock";
import { witness } from "../../test-support/witness";
import { differenceOnDay } from "./time";

const RUNS = 300;
const ZONES = [
  "Asia/Tokyo", "America/Los_Angeles", "Europe/London", "Asia/Kolkata", "Asia/Kathmandu",
  "Australia/Adelaide", "Australia/Sydney", "America/St_Johns", "Pacific/Kiritimati", "Pacific/Pago_Pago",
  "America/Sao_Paulo", "Atlantic/Reykjavik", "Pacific/Chatham",
];
const dateArb = fc
  .date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2035, 11, 31)), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

const wallMinutes = (zone: string, instant: number) => {
  const { date, time } = clockIn(zone, instant);
  return Date.parse(`${date}T${time}:00Z`) / 60_000;
};

describe("day.fromHome properties", () => {
  it("prints the difference two wall clocks show at the day's noon", () => {
    const w = witness("difference is the wall clocks'");
    fc.assert(
      fc.property(fc.constantFrom(...ZONES), fc.constantFrom(...ZONES), dateArb, (zone, home, date) => {
        const minutes = differenceOnDay(zone, home, date);
        // Noon in the day's zone, found from its own clock rather than from
        // `noonIn`: the day's date at 12:00 there.
        const utcNoon = Date.parse(`${date}T12:00:00Z`);
        const noon = utcNoon - (wallMinutes(zone, utcNoon) * 60_000 - utcNoon);
        expect(minutes).toBe(wallMinutes(zone, noon) - wallMinutes(home, noon));
        w.tick();
      }),
      { numRuns: RUNS },
    );
    // No guard clause: every run asserts, so the floor is exact.
    w.atLeast(RUNS);
  });
});
