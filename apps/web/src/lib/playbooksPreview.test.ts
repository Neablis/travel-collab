import { describe, expect, it } from "vitest";
import { dayDescription, dayFactsLine, dayIndexable, type DayFacts } from "./playbooksPreview";

const facts: DayFacts = { cities: ["Kyoto", "Osaka"], dayCount: 3, stopCount: 12, author: "Dana R.", rating: null, reviewCount: 0 };

describe("dayFactsLine", () => {
  it("names the cities, the days past one, the stops and the author", () => {
    expect(dayFactsLine(facts)).toBe("Kyoto, Osaka · 3 days · 12 stops · by Dana R.");
    expect(dayFactsLine({ ...facts, cities: ["Kyoto"], dayCount: 1, stopCount: 1 })).toBe("Kyoto · 1 stop · by Dana R.");
  });

  it("opens on the stops when the day names no city", () => {
    expect(dayFactsLine({ ...facts, cities: [] })).toBe("3 days · 12 stops · by Dana R.");
  });

  it("states a rating only once somebody has left one", () => {
    expect(dayFactsLine({ ...facts, rating: 4.6, reviewCount: 12 })).toBe(
      "Kyoto, Osaka · 3 days · 12 stops · by Dana R. · rated 4.6 from 12 reviews",
    );
    expect(dayFactsLine({ ...facts, rating: 4.6, reviewCount: 0 })).not.toContain("rated");
  });
});

describe("dayDescription", () => {
  it("is the author's own summary when the day has one", () => {
    expect(dayDescription("  Temples before the crowds, then the river. ", facts)).toBe("Temples before the crowds, then the river.");
  });

  it("is the facts line for a day with no summary, or a blank one", () => {
    expect(dayDescription(null, facts)).toBe(dayFactsLine(facts));
    expect(dayDescription("", facts)).toBe(dayFactsLine(facts));
    expect(dayDescription(" \n ", facts)).toBe(dayFactsLine(facts));
  });
});

describe("dayIndexable", () => {
  const hidden = { moderatedAt: "2026-09-23T00:00:00.000Z", moderationNote: null };

  it("is true only for a published day no operator has hidden", () => {
    expect(dayIndexable({ day: { visibility: "public" }, moderation: null })).toBe(true);
    // The author's own read of a private day, and of a published day an operator hid.
    expect(dayIndexable({ day: { visibility: "private" }, moderation: null })).toBe(false);
    expect(dayIndexable({ day: { visibility: "public" }, moderation: hidden })).toBe(false);
  });
});
