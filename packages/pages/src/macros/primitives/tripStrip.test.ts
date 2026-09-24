import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { TripStripPayload, WidgetContext } from "../../registry-types";
import { witness } from "../../test-support/witness";

// "Trip strip": one cell per day, grouped into runs of consecutive same-city
// days. What a reader cannot check from the picture is the grouping itself — a
// day dropped, two days swapped, or a city the trip returns to merged into its
// first visit — so those are what is pinned.

const contextOf = (trip: TripDetail | undefined): WidgetContext => ({
  trip,
  page: { tripId: trip?.tripId ?? "t" },
  user: null,
  globals: null,
  today: null,
});

// One located stop per day, in exactly the given city (`null` = a day whose
// stop names no place), dated from 2027-06-01.
function tripWithCities(cities: readonly (string | null)[]): TripDetail {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: cities.length, activitiesPerDay: 1 } });
  trip.days = trip.days.map((day, index) => ({ ...day, date: `2027-06-${String(index + 1).padStart(2, "0")}` }));
  trip.days.forEach((day, index) => {
    const id = day.activityIds[0]!;
    const city = cities[index]!;
    trip.activities[id] = { ...trip.activities[id]!, location: city === null ? null : { name: `${city} stop`, city } };
  });
  return trip;
}

const stripOf = (trip: TripDetail): TripStripPayload => {
  const outcome = renderMacro(contextOf(trip), "trip.strip", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "trip-strip") {
    throw new Error(`expected a trip-strip block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
};

const shapeOf = (strip: TripStripPayload) =>
  strip.runs.map((run) => [run.city, run.days.map((day) => day.ordinal)] as const);

describe("trip.strip", () => {
  it("groups consecutive same-city days into one run, and a return visit into a new one", () => {
    const strip = stripOf(tripWithCities(["Tokyo", "Tokyo", "Kyoto", "Kyoto", "Kyoto", "Tokyo"]));
    expect(shapeOf(strip)).toEqual([
      ["Tokyo", [1, 2]],
      ["Kyoto", [3, 4, 5]],
      ["Tokyo", [6]],
    ]);
  });

  it("gives days with no city a run of their own, with no city on it", () => {
    const strip = stripOf(tripWithCities(["Tokyo", null, null, "Kyoto"]));
    expect(shapeOf(strip)).toEqual([
      ["Tokyo", [1]],
      [null, [2, 3]],
      ["Kyoto", [4]],
    ]);
  });

  it("names a day by the city of its LAST located stop — the board's rule", () => {
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 3 } });
    const [first, second, third] = trip.days[0]!.activityIds as [string, string, string];
    trip.activities[first] = { ...trip.activities[first]!, location: { name: "Senso-ji", city: "Tokyo" } };
    trip.activities[second] = { ...trip.activities[second]!, location: { name: "Fushimi Inari", area: "Fushimi" } };
    trip.activities[third] = { ...trip.activities[third]!, location: null };
    expect(shapeOf(stripOf(trip))).toEqual([["Fushimi", [1]]]);
  });

  it("hands the renderer display-ready dates and the day ids the colour is keyed on", () => {
    const trip = tripWithCities(["Tokyo", "Kyoto"]);
    trip.days[1] = { ...trip.days[1]!, date: null };
    const days = stripOf(trip).runs.flatMap((run) => run.days);
    expect(days).toEqual([
      { dayId: trip.days[0]!.dayId, ordinal: 1, date: "Jun 1", city: "Tokyo" },
      { dayId: trip.days[1]!.dayId, ordinal: 2, date: null, city: "Kyoto" },
    ]);
  });

  it("summarises the runs in words, for the strip's accessible name", () => {
    const strip = stripOf(tripWithCities(["Tokyo", "Tokyo", "Tokyo", "Tokyo", "Kyoto", null, null]));
    expect(strip.summary).toBe(
      "Days 1–4 Tokyo (Jun 1 – Jun 4), day 5 Kyoto (Jun 5), days 6–7 no city yet (Jun 6 – Jun 7)",
    );
  });

  it("is empty when the trip has no days", () => {
    expect(renderMacro(contextOf(tripWithCities([])), "trip.strip", {})).toEqual({ status: "empty" });
  });

  it("asks for a trip when it has none", () => {
    expect(renderMacro(contextOf(undefined), "trip.strip", {})).toEqual({ status: "unbound", needs: "trip" });
  });

  it("[property] the runs partition the trip's days, in order, each run one city, neighbours different", () => {
    const w = witness("trip strip partition");
    fc.assert(
      fc.property(
        fc.array(fc.option(fc.constantFrom("Tokyo", "Kyoto", "Osaka"), { nil: null }), { minLength: 1, maxLength: 20 }),
        (cities) => {
          const trip = tripWithCities(cities);
          const { runs } = stripOf(trip);
          // Every day exactly once, in trip order: concatenating the runs gives
          // the trip's day ids back, no more, no fewer, none moved.
          expect(runs.flatMap((run) => run.days.map((day) => day.dayId))).toEqual(trip.days.map((day) => day.dayId));
          runs.forEach((run, index) => {
            w.tick();
            expect(run.days.length).toBeGreaterThan(0);
            for (const day of run.days) expect(day.city).toBe(run.city);
            // Maximal: two neighbouring runs of the same city should have been one.
            if (index > 0) expect(runs[index - 1]!.city).not.toBe(run.city);
          });
        },
      ),
      { numRuns: 100 },
    );
    // One tick per run. Measured over five seeds: 422-488 (about 4.6 runs per
    // trip of 1-20 days drawn from three cities and "none"). The floor is half
    // the observed minimum, per `witness`'s own rule.
    w.atLeast(210);
  });
});
