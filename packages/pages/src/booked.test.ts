import { describe, expect, it } from "vitest";
import { isBooked } from "./booked";

// The rule behind `stop.rows{only: "booked"}`: a stop is booked when it carries
// a booking at all. A reader below editor gets `{ provider: null }`, which
// still says "booked" (ADR-086 decision 2), so the test is "non-null", never
// "has a confirmation".
describe("isBooked", () => {
  it("is false for a stop with no booking", () => {
    expect(isBooked({ booking: null })).toBe(false);
  });

  it("is true for any booking, including one redacted to a null provider", () => {
    expect(isBooked({ booking: { provider: "Trenitalia", confirmation: "ABC123" } })).toBe(true);
    expect(isBooked({ booking: { confirmation: "ABC123" } })).toBe(true);
    expect(isBooked({ booking: { provider: null } })).toBe(true);
  });
});
