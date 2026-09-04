// Pins the exact bug Mitchell reported: "the colors here for each location
// doesn't match the color you applied in the timeline and columns for the
// cities". Before this fix, the sparkline (NextTripHero's home hero) colored
// cities from its own 8-hue hashed palette (sparklineColor.ts) while
// Board/Column/DayChips colored the SAME cities from dayAccents' 5 semantic
// families — two independent systems that had no reason to agree, and
// didn't. This test builds one real TripDetail (via @tc/factories, ADR-020)
// and drives both surfaces' real derivation code (DayChips.chipModel for the
// board, Sparkline.shapeOf for the sparkline) off it, asserting they resolve
// every day's city to the identical accent family.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import { chipModel, cityFor } from "@/components/trip/DayChips";
import { shapeOf } from "@/components/trip/Sparkline";
import { dayAccents, ACCENT_FAMILIES } from "@/lib/dayAccent";
import { cityAccents } from "@/components/pages/cityAccents";
import { witness } from "@/test-support/witness";

const CITY_POOL = ["Tokyo", "Kyoto", "Osaka", "Nikkō", "Hakone", "Naoshima", "Rome", "Paris", "Lisbon", "Berlin"];

// Builds a real TripDetail with exactly the given per-day cities (null =
// "no located activity that day"), reusing tripDetailFactory's real
// day/activity id plumbing rather than hand-rolling a TripDetail shape that
// could drift from the contract.
function tripWithCities(cities: readonly (string | null)[]) {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: cities.length, activitiesPerDay: 1 } });
  trip.days.forEach((day, index) => {
    const activityId = day.activityIds[0]!;
    const city = cities[index]!;
    trip.activities[activityId] = {
      ...trip.activities[activityId]!,
      location: city === null ? null : { name: city, city },
    };
  });
  return trip;
}

describe("city accent consistency across the sparkline, the board and a notebook page", () => {
  it("[property] a city appearing on any surface resolves to the same accent family", () => {
    const w = witness("sparkline/board accent agreement");
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.constantFrom(...CITY_POOL), { nil: null }), { minLength: 1, maxLength: 12 }),
        (cities) => {
          const trip = tripWithCities(cities);

          // The board's real derivation (Board.tsx: chipModel -> dayAccents).
          const boardAccents = dayAccents(chipModel(trip).map((day) => day.city));

          // The sparkline's real derivation (NextTripHero.tsx mirrors this
          // exact cityFor mapping before handing days to Sparkline).
          const sparklineGroups = shapeOf(
            trip.days.map((day) => ({ city: cityFor(day, trip.activities), stopCount: day.activityIds.length })),
          );

          // The notebook's real derivation (MacroView -> cityAccents), which a
          // widget naming a city reads for its colour.
          const notebook = cityAccents(trip);

          for (let i = 0; i < cities.length; i++) {
            w.tick();
            expect(sparklineGroups[i]!.family).toBe(boardAccents[i]!.tint);
            // The notebook is the third surface with the same obligation. It
            // is asked BOTH ways it can be asked — by day and by city name —
            // because a widget rendering "Every day at a glance" colours rows
            // by day and `day.line` colours words by city.
            expect(notebook.ofDayId(trip.days[i]!.dayId)).toBe(boardAccents[i]!.tint);
            expect(notebook.ofCity(cities[i]!)).toBe(boardAccents[i]!.tint);
          }
        },
      ),
      { numRuns: 100 },
    );
    // Each of the ~100 runs generates 1-12 days; a floor near half the
    // observed minimum (measured: comfortably 500+) catches a guard clause
    // or a generator collapse without flapping on ordinary variance.
    w.atLeast(300);
  });

  it("a null city renders the explicit neutral family on both surfaces, never a hashed one", () => {
    const trip = tripWithCities(["Tokyo", null, "Kyoto"]);
    const boardAccents = dayAccents(chipModel(trip).map((day) => day.city));
    const sparklineGroups = shapeOf(
      trip.days.map((day) => ({ city: cityFor(day, trip.activities), stopCount: day.activityIds.length })),
    );
    expect(boardAccents[1]!.tint).toBe("neutral");
    expect(sparklineGroups[1]!.family).toBe("neutral");
    // A day with no located stop has no colour on a notebook page either, and
    // a city the trip never names resolves to the same explicit neutral rather
    // than to a hashed one it would then share with a real city.
    const notebook = cityAccents(trip);
    expect(notebook.ofDayId(trip.days[1]!.dayId)).toBe("neutral");
    expect(notebook.ofCity(null)).toBe("neutral");
    expect(notebook.ofCity("Lisbon")).toBe("neutral");
    expect(ACCENT_FAMILIES).not.toContain("neutral");
  });

  // Mitchell's accepted trade-off (2026-08-25): a trip with more than 5
  // distinct cities has one pair sharing a family. The two surfaces must
  // still agree on WHICH family each shared city gets, not just that both
  // degrade gracefully.
  it("agrees on the shared family even past the 5-city ceiling", () => {
    const cities = ["Tokyo", "Nikkō", "Hakone", "Kyoto", "Osaka", "Naoshima"];
    const trip = tripWithCities(cities);
    const boardAccents = dayAccents(chipModel(trip).map((day) => day.city));
    const sparklineGroups = shapeOf(
      trip.days.map((day) => ({ city: cityFor(day, trip.activities), stopCount: day.activityIds.length })),
    );
    const notebook = cityAccents(trip);
    for (let i = 0; i < cities.length; i++) {
      expect(sparklineGroups[i]!.family).toBe(boardAccents[i]!.tint);
      expect(notebook.ofCity(cities[i]!)).toBe(boardAccents[i]!.tint);
      expect(sparklineGroups[i]!.family).not.toBe("neutral");
    }
    expect(new Set(sparklineGroups.map((g) => g.family)).size).toBe(5);
  });
});
