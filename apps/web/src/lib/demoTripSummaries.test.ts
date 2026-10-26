import { describe, expect, it } from "vitest";
import { DEMO_TRIPS } from "@/lib/demoTrip";
import { demoTripCard } from "@/lib/demoTripCards";
import { DEMO_TRIP_SUMMARIES, demoTripSummary } from "@/lib/demoTripSummaries";

// The summaries are the committed snapshot `scripts/landing-demo.ts` writes
// (M53 part 2); `landing:verify` already fails on drift from the fold. What
// it cannot say is whether the snapshot covers every demo the page can be
// asked for, so that is what lives here: one summary per demo, in picker
// order, with the day count the picker's own card carries.
describe("demoTripSummaries", () => {
  it("covers every demo, in DEMO_TRIPS order, with the card's day count", () => {
    expect(DEMO_TRIP_SUMMARIES.map((summary) => summary.slug)).toEqual(
      DEMO_TRIPS.map((demo) => demo.slug),
    );
    for (const summary of DEMO_TRIP_SUMMARIES) {
      const card = demoTripCard(summary.slug)!;
      expect(summary.name).toBe(card.name);
      expect(summary.days.length).toBe(card.dayCount);
      expect(summary.days.length).toBeGreaterThan(0);
    }
  });

  it("names each day by its ordinal and gives every stop a title", () => {
    for (const summary of DEMO_TRIP_SUMMARIES) {
      summary.days.forEach((day, index) => {
        expect(day.name).toBe(`Day ${index + 1}`);
        for (const stop of day.stops) expect(stop.length).toBeGreaterThan(0);
      });
      for (const stop of summary.unscheduled) expect(stop.length).toBeGreaterThan(0);
    }
  });

  it("answers undefined for a slug that is no demo", () => {
    expect(demoTripSummary("no-such-demo")).toBeUndefined();
  });
});
