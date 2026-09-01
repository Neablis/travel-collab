import { describe, expect, it } from "vitest";
import { SEASON_MONTHS, Season, seasonOfInstant, seasonOfMonth } from "./playbooks";

// The season lookup is the whole of Discover's `?season=` filter — there is no
// column behind it (Mitchell, 2026-09-01: "no db just do a lookup for now") —
// and the SAME table is expanded into the SQL predicate, so a hole here is a
// filter that silently returns nothing for some month of the year.
describe("seasonOfMonth", () => {
  it("gives every one of the twelve months a season", () => {
    // The witness floor: this loop would pass vacuously over an empty range,
    // so the count is asserted first.
    const months = Array.from({ length: 12 }, (_, i) => i + 1);
    expect(months).toHaveLength(12);
    for (const month of months) {
      expect(seasonOfMonth(month), `month ${month}`).not.toBeNull();
    }
  });

  it("puts each month in exactly one season", () => {
    const seen = new Map<number, Season>();
    for (const [season, months] of Object.entries(SEASON_MONTHS) as [Season, readonly number[]][]) {
      for (const month of months) {
        expect(seen.has(month), `month ${month} is in two seasons`).toBe(false);
        seen.set(month, season);
      }
    }
    expect(seen.size).toBe(12);
  });

  it("buckets the boundaries the way the labels claim", () => {
    // Meteorological, northern hemisphere. Written out rather than derived
    // from SEASON_MONTHS, so re-bucketing has to be a deliberate edit here too.
    expect(seasonOfMonth(3)).toBe("spring");
    expect(seasonOfMonth(5)).toBe("spring");
    expect(seasonOfMonth(6)).toBe("summer");
    expect(seasonOfMonth(9)).toBe("fall");
    expect(seasonOfMonth(11)).toBe("fall");
    // Winter is the one that wraps the year end, which is the case a naive
    // range check gets wrong.
    expect(seasonOfMonth(12)).toBe("winter");
    expect(seasonOfMonth(1)).toBe("winter");
    expect(seasonOfMonth(2)).toBe("winter");
  });

  it("has no answer for something that is not a month", () => {
    expect(seasonOfMonth(0)).toBeNull();
    expect(seasonOfMonth(13)).toBeNull();
    expect(seasonOfMonth(null)).toBeNull();
    expect(seasonOfMonth(undefined)).toBeNull();
  });
});

describe("seasonOfInstant", () => {
  it("reads the month in UTC, matching the SQL predicate", () => {
    // The filter is `extract(month from created_at at time zone 'UTC')`. A day
    // saved just after midnight UTC on 1 September is September — and would be
    // August, and so a different season, if this read local time in any
    // negative-offset zone.
    expect(seasonOfInstant("2026-09-01T00:30:00.000Z")).toBe("fall");
    expect(seasonOfInstant("2026-08-31T23:30:00.000Z")).toBe("summer");
  });

  it("has no answer for an unparseable timestamp", () => {
    expect(seasonOfInstant("not a date")).toBeNull();
  });
});
