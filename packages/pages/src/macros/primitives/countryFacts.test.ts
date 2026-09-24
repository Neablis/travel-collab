import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";

// "Know before you go": one card per country the trip stops in. The failure
// modes worth a test are the ones a reader cannot see from the card itself — a
// country missing because a parked idea was counted instead of a real stop, the
// same country twice, or the countries in an order that is not the trip's.

const contextOf = (trip: TripDetail | undefined): WidgetContext => ({
  trip,
  page: { tripId: trip?.tripId ?? "t" },
  user: null,
  globals: null,
  today: null,
});

// `located: true` walks the factory's real-place pool in order, so two days of
// two stops land Rome, Rome | Vatican City, Kyoto — Italy, the Vatican, Japan.
const locatedTrip = () =>
  tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2, unscheduledCount: 1, located: true } });

const countriesOf = (trip: TripDetail) => {
  const outcome = renderMacro(contextOf(trip), "country.facts", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "country-facts") {
    throw new Error(`expected a country-facts block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block.countries;
};

describe("country.facts", () => {
  it("is one card per country, in trip order, each country once", () => {
    const trip = locatedTrip();
    expect(countriesOf(trip).map((card) => card.code)).toEqual(["IT", "VA", "JP"]);
  });

  it("does not count a parked idea as somewhere the trip goes", () => {
    const trip = locatedTrip();
    const parked = trip.backlog[0]!;
    trip.activities[parked] = { ...trip.activities[parked]!, location: { name: "Louvre", countryCode: "FR" } };
    expect(countriesOf(trip).map((card) => card.code)).not.toContain("FR");
  });

  it("reads the country off a stop's address when the geocoder left none", () => {
    const trip = locatedTrip();
    const first = trip.days[0]!.activityIds[0]!;
    trip.activities[first] = {
      ...trip.activities[first]!,
      location: { name: "Somewhere", address: { countryCode: "DE", lines: ["Hauptstraße 5"] } },
    };
    expect(countriesOf(trip).map((card) => card.code)).toEqual(["DE", "IT", "VA", "JP"]);
  });

  it("hands the card display-ready strings, data values separate from prose", () => {
    const [, , japan] = countriesOf(locatedTrip());
    expect(japan).toEqual({
      code: "JP",
      name: "Japan",
      plugs: "A, B",
      power: "100 V · 50/60 Hz",
      drives: "Left",
      emergency: "110 · 119",
      currency: "JPY · Yen",
      callingCode: "+81",
      tipping: "Not expected",
    });
  });

  it("is empty — with the widget's own nudge — when no stop has a place", () => {
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2 } });
    expect(renderMacro(contextOf(trip), "country.facts", {})).toEqual({ status: "empty" });
  });

  it("skips a place outside the table rather than inventing a card for it", () => {
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 1, activitiesPerDay: 1 } });
    const only = trip.days[0]!.activityIds[0]!;
    trip.activities[only] = { ...trip.activities[only]!, location: { name: "McMurdo", countryCode: "AQ" } };
    expect(renderMacro(contextOf(trip), "country.facts", {})).toEqual({ status: "empty" });
  });

  it("asks for a trip when it has none", () => {
    expect(renderMacro(contextOf(undefined), "country.facts", {})).toEqual({ status: "unbound", needs: "trip", shape: expect.any(Array) });
  });
});
