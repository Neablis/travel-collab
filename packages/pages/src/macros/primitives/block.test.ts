import { describe, expect, it } from "vitest";
import { renderMacro } from "../../registry";
import type { ItineraryTripPayload, WidgetContext } from "../../registry-types";
import { selectionTrip } from "../../test-support/selectionTrip";

// `block` is the shape ADR-039 was written about: `itinerary.trip` rendered a
// list of lists because *"nothing in the model said what a block widget does
// when its selection holds many members, so a widget answered it locally, and
// wrongly"*. These pin the answer the model gives instead.

const contextOf = ({ trip, globals }: ReturnType<typeof selectionTrip>): WidgetContext => ({
  trip,
  page: { tripId: trip.tripId },
  user: null,
  globals,
});

describe("day.detail", () => {
  it("is one day's card when the selection holds one day — what `itinerary.day` drew", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    expect(renderMacro(ctx, "day.detail", { day: { kind: "index", index: 0 } })).toEqual({
      status: "ok",
      rendered: {
        kind: "block",
        block: {
          kind: "itinerary-day",
          dayId: fixture.trip.days[0]!.dayId,
          ordinal: 1,
          date: "2027-06-01",
          activities: [
            { title: "Colosseum", timeWindow: "09:00–10:00", cost: expect.any(String) },
            { title: "Lunch", timeWindow: "12:00–13:00", cost: expect.any(String) },
          ],
        },
      },
    });
  });

  it("is the day table when it holds many — what `itinerary.trip` drew", () => {
    const ctx = contextOf(selectionTrip());
    const outcome = renderMacro(ctx, "day.detail", {});
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block") throw new Error(`not a block: ${outcome.status}`);
    const payload = outcome.rendered.block as ItineraryTripPayload;
    // One row per day of the trip, in trip order, each with its own stops —
    // NOT a stack of day cards, which is the bug ADR-039 was written about.
    expect(payload.kind).toBe("itinerary-trip");
    expect(payload.days.map((d) => d.ordinal)).toEqual([1, 2, 3]);
    expect(payload.days.map((d) => d.activities.map((a) => a.title))).toEqual([
      ["Colosseum", "Lunch"],
      ["Train to Kyoto", "Ryokan"],
      ["Free morning", "Maybe a hike"],
    ]);
  });

  it("keeps only the days that have a matching stop once a content filter is set", () => {
    // The spec's own missing preset: *everything on a day, booked only*. Day 3
    // has no booking, so it is dropped rather than rendered as an empty card —
    // the reader asked for the bookings, not for a census of days.
    const ctx = contextOf(selectionTrip());
    const outcome = renderMacro(ctx, "day.detail", { kind: "booked" });
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block") throw new Error(`not a block: ${outcome.status}`);
    const payload = outcome.rendered.block as ItineraryTripPayload;
    expect(payload.kind).toBe("itinerary-trip");
    expect(payload.days.map((d) => d.ordinal)).toEqual([1, 2]);
    // Only the booked stop survives inside each card.
    expect(payload.days.flatMap((d) => d.activities.map((a) => a.title))).toEqual(["Colosseum", "Ryokan"]);
  });

  it("numbers a card by its day of the TRIP, not its place in the selection", () => {
    // `day.detail{tag: lodging}` leaves only day 2. Labelling it "Day 1" would
    // print the selection's private numbering onto the page as a fact about the
    // trip.
    const ctx = contextOf(selectionTrip());
    const outcome = renderMacro(ctx, "day.detail", { tag: "lodging" });
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block") throw new Error(`not a block: ${outcome.status}`);
    expect(outcome.rendered.block).toMatchObject({ kind: "itinerary-day", ordinal: 2 });
  });

  it("is empty when a filter leaves no day with anything on it", () => {
    const ctx = contextOf(selectionTrip());
    expect(renderMacro(ctx, "day.detail", { tag: "meal", kind: "booked" }).status).toBe("empty");
  });
});

describe("city.detail", () => {
  it("details every city the trip touches, numbering days from 1", () => {
    // `dayIndexes` counts from 0 because that is how the projection addresses
    // days; a card saying "Day 0" would be its private convention on the page.
    const ctx = contextOf(selectionTrip());
    expect(renderMacro(ctx, "city.detail", {})).toEqual({
      status: "ok",
      rendered: {
        kind: "block",
        block: {
          kind: "city-detail",
          cities: [
            { name: "Rome", dayOrdinals: [1, 2], activityCount: 2 },
            { name: "Kyoto", dayOrdinals: [2], activityCount: 2 },
          ],
        },
      },
    });
  });

  it("narrows to one city", () => {
    const ctx = contextOf(selectionTrip());
    const outcome = renderMacro(ctx, "city.detail", { city: "Kyoto" });
    expect(outcome.status === "ok" && outcome.rendered.kind === "block" && outcome.rendered.block).toMatchObject({
      cities: [{ name: "Kyoto" }],
    });
  });

  it("is empty without the globals projection, rather than inventing a city list", () => {
    const { trip } = selectionTrip();
    const ctx: WidgetContext = { trip, page: { tripId: trip.tripId }, user: null, globals: null };
    expect(renderMacro(ctx, "city.detail", {}).status).toBe("empty");
  });
});
