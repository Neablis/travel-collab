import { describe, expect, it } from "vitest";
import { formatTripDate, formatTripDateLong, ordinalDayOfMonth } from "./formatDate";

describe("formatTripDate", () => {
  it("renders a short human date without a year", () => {
    expect(formatTripDate("2026-07-12")).toBe("Sun, Jul 12");
  });
  it("renders a long human date with the year", () => {
    expect(formatTripDateLong("2026-07-12")).toBe("Sun, Jul 12, 2026");
  });
  it("is timezone-stable (parses the calendar date, not an instant)", () => {
    expect(formatTripDate("2026-01-01")).toBe("Thu, Jan 1");
  });
});

describe("ordinalDayOfMonth", () => {
  it("uses st/nd/rd for 1, 2 and 3", () => {
    expect(ordinalDayOfMonth(1)).toBe("1st");
    expect(ordinalDayOfMonth(2)).toBe("2nd");
    expect(ordinalDayOfMonth(3)).toBe("3rd");
    expect(ordinalDayOfMonth(4)).toBe("4th");
  });
  // The case a last-digit-only implementation gets wrong, and the reason the
  // helper is not a one-line `% 10` lookup.
  it("uses th for 11, 12 and 13, not st/nd/rd", () => {
    expect(ordinalDayOfMonth(11)).toBe("11th");
    expect(ordinalDayOfMonth(12)).toBe("12th");
    expect(ordinalDayOfMonth(13)).toBe("13th");
  });
  it("follows the last digit again from 21", () => {
    expect(ordinalDayOfMonth(21)).toBe("21st");
    expect(ordinalDayOfMonth(22)).toBe("22nd");
    expect(ordinalDayOfMonth(23)).toBe("23rd");
    expect(ordinalDayOfMonth(24)).toBe("24th");
  });
  it("covers the rest of a month's range", () => {
    expect(ordinalDayOfMonth(30)).toBe("30th");
    expect(ordinalDayOfMonth(31)).toBe("31st");
  });
});
