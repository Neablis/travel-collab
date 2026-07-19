import { describe, expect, it } from "vitest";
import { formatTripDate, formatTripDateLong } from "./formatDate";

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
