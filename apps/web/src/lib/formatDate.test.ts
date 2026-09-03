import { describe, expect, it } from "vitest";
import { formatRelativeInstant, formatTripDate, formatTripDateLong, ordinalDayOfMonth } from "./formatDate";

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

describe("formatRelativeInstant", () => {
  // Fixed, so these assert a string rather than racing the clock.
  const NOW = new Date("2026-09-03T12:00:00.000Z");
  const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;

  it("picks the largest unit the elapsed time reaches", () => {
    expect(formatRelativeInstant(ago(4 * HOUR), NOW)).toBe("4 hours ago");
    expect(formatRelativeInstant(ago(2 * DAY), NOW)).toBe("2 days ago");
    expect(formatRelativeInstant(ago(90 * DAY), NOW)).toBe("3 months ago");
    // 45 minutes is not "0 hours ago" — the unit has to be the largest one
    // the elapsed time actually REACHES, not the largest one it rounds to.
    expect(formatRelativeInstant(ago(45 * MINUTE), NOW)).toBe("45 minutes ago");
  });

  it("says yesterday rather than 1 day ago", () => {
    // `numeric: "auto"`. The freshness line is prose, and this is the word a
    // person uses.
    expect(formatRelativeInstant(ago(DAY), NOW)).toBe("yesterday");
  });

  it("collapses anything under a minute to just now", () => {
    expect(formatRelativeInstant(ago(30 * 1000), NOW)).toBe("just now");
  });

  it("never renders a future instant, however far ahead the row's clock is", () => {
    // Ordinary skew: a server timestamp a couple of seconds ahead of the
    // browser's. "edited in 2 seconds" is a bug report, not a freshness line.
    expect(formatRelativeInstant(new Date(NOW.getTime() + 2000).toISOString(), NOW)).toBe("just now");
    // A genuinely wrong clock. This is the half a symmetric `Math.abs` gets
    // wrong in the other direction — it would render this as "2 hours ago",
    // inventing a past as false as the future it avoided.
    expect(formatRelativeInstant(new Date(NOW.getTime() + 2 * HOUR).toISOString(), NOW)).toBe("just now");
  });

  it("returns null for something that is not an instant, rather than Invalid Date", () => {
    expect(formatRelativeInstant("not-a-date", NOW)).toBeNull();
  });
});
