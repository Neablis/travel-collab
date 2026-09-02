import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { DistanceUnit } from "@tc/contracts";
import { kmLabel } from "./units";
import { witness } from "@/test-support/witness";

const MILES_PER_KM = 0.621371;

// A distance this app actually produces: a haversine gap between two pins, in
// metre resolution, spread across the three magnitudes that pick different
// branches — a walk between two stops, a day's worth of moving, and a
// Tokyo-to-Fukuoka hop. A single flat range would put the feet branch out of
// reach at any realistic run count (0.31 km of 5000 is 0.006% of the space),
// and the per-branch witnesses below are what proves that has not happened.
const tripDistanceKm = fc.oneof(
  fc.integer({ min: 0, max: 999 }).map((m) => m / 1000),
  fc.integer({ min: 0, max: 50_000 }).map((m) => m / 1000),
  fc.integer({ min: 0, max: 5_000_000 }).map((m) => m / 1000),
);

const anyUnit = fc.constantFrom<DistanceUnit>("km", "mi");

/** What the label claims, read back as kilometres. */
function labelledKm(label: string): number {
  const [value, unit] = label.split(" ");
  const n = Number(value);
  switch (unit) {
    case "m":
      return n / 1000;
    case "km":
      return n;
    case "ft":
      return n / 5280 / MILES_PER_KM;
    case "mi":
      return n / MILES_PER_KM;
    default:
      throw new Error(`kmLabel produced an unknown unit: ${label}`);
  }
}

describe("kmLabel", () => {
  describe("the SPEC §12 boundaries", () => {
    // "Miles below 0.19 render as feet" — the switch is on the MILE value, so
    // the kilometre either side of it is what the call sites will actually pass.
    const feetSide = (0.19 - 0.0005) / MILES_PER_KM;
    const milesSide = (0.19 + 0.0005) / MILES_PER_KM;

    it("renders feet just below 0.19 mi and miles just above", () => {
      expect(kmLabel(feetSide, "mi")).toMatch(/ ft$/);
      expect(kmLabel(milesSide, "mi")).toMatch(/ mi$/);
    });

    // "km below 1 as metres" — and 1 km exactly is NOT below 1.
    it("renders metres below 1 km and kilometres at 1 km", () => {
      expect(kmLabel(0.999, "km")).toMatch(/ m$/);
      expect(kmLabel(1, "km")).toBe("1.0 km");
    });

    it("quantises the small units to 50", () => {
      expect(kmLabel(0.347, "km")).toBe("350 m");
      expect(kmLabel(0.075, "km")).toBe("100 m");
      expect(kmLabel(0.1, "mi")).toBe("350 ft");
    });

    it("drops the tenth above 10 units, and keeps it below", () => {
      expect(kmLabel(4.24, "km")).toBe("4.2 km");
      expect(kmLabel(12.4, "km")).toBe("12 km");
      expect(kmLabel(4.24, "mi")).toBe("2.6 mi");
      expect(kmLabel(42, "mi")).toBe("26 mi");
    });

    it("has no unit but the reader's", () => {
      expect(kmLabel(500, "km")).toBe("500 km");
      expect(kmLabel(500, "mi")).toBe("311 mi");
    });
  });

  // The claim is "for ALL distances", so it is a property, not a table. Two
  // things are asserted per case: the label is a number and one of exactly four
  // units, and the number it states is true to within that branch's own
  // rounding step. A label that lied by more than its step would be a wrong
  // distance rendered confidently, which is worse than an unrounded one.
  it("states a number and a unit, and the number is true to within its rounding step", () => {
    const w = witness("kmLabel shape and accuracy");
    // One per branch, because the vacuity this is guarding against is not "no
    // assertions ran" — it is the generator drifting until three quarters of
    // the function is never reached and the property still reports green.
    const branch = {
      ft: witness("kmLabel feet branch"),
      mi: witness("kmLabel miles branch"),
      m: witness("kmLabel metres branch"),
      km: witness("kmLabel kilometres branch"),
    } as const;

    fc.assert(
      fc.property(tripDistanceKm, anyUnit, (km, unit) => {
        const label = kmLabel(km, unit);
        expect(label).toMatch(/^\d+(\.\d)? (ft|mi|m|km)$/);

        // The reader asked for one system and gets one system: never a metre
        // label from "mi", never a foot label from "km".
        const [, suffix] = label.split(" ");
        expect(suffix === "ft" || suffix === "mi").toBe(unit === "mi");
        branch[suffix as keyof typeof branch].tick();

        // Every branch's worst case is half its own step, converted back to km:
        // 25 ft, 25 m, 0.05 mi, 0.5 mi, 0.05 km, 0.5 km. The epsilon absorbs
        // the double arithmetic in `labelledKm`, not any real slack.
        const step =
          suffix === "ft"
            ? 25 / 5280 / MILES_PER_KM
            : suffix === "m"
              ? 0.025
              : suffix === "mi"
                ? (km * MILES_PER_KM < 10 ? 0.05 : 0.5) / MILES_PER_KM
                : km < 10
                  ? 0.05
                  : 0.5;
        expect(Math.abs(labelledKm(label) - km)).toBeLessThanOrEqual(step + 1e-9);
        w.tick();
      }),
    );

    w.atLeast(50);
    // Measured floors, not guessed (AGENTS.md's testing model). Observed
    // minimums over 40 runs of 100 cases: ft 6, mi 24, m 17, km 17 — and the
    // property has no guard clause, so the total is exactly 100 every run.
    // Each floor is half its observed minimum: clear of fast-check's
    // run-to-run variance, and still red the moment a branch stops being
    // generated at all.
    branch.ft.atLeast(3);
    branch.mi.atLeast(12);
    branch.m.atLeast(8);
    branch.km.atLeast(8);
  });
});
