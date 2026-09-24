import { describe, expect, it } from "vitest";
import { ActivityKind } from "@tc/contracts";
import { needsBooking } from "./needsBooking";

// The rule as Mitchell decided it on 2026-08-29, one row per kind. Enumerated
// over `ActivityKind.options` rather than a list written here, so a kind added
// to the contract fails the "every kind has an answer" line below until
// somebody decides what it means for booking.
const EXPECTED: Record<ActivityKind, { plain: boolean; ticketed: boolean }> = {
  booked: { plain: false, ticketed: false },
  transit: { plain: false, ticketed: false },
  hold: { plain: true, ticketed: true },
  idea: { plain: true, ticketed: true },
  // The one exception: `planned` is the zero value every stop gets for free,
  // so only a ticketed one owes an action.
  planned: { plain: false, ticketed: true },
};

describe("needsBooking", () => {
  it("answers every kind, with and without the ticketed tag", () => {
    let checked = 0;
    for (const kind of ActivityKind.options) {
      expect(needsBooking({ kind, tags: ["meal"] }), `${kind}, not ticketed`).toBe(EXPECTED[kind].plain);
      expect(needsBooking({ kind, tags: ["meal", "ticketed"] }), `${kind}, ticketed`).toBe(EXPECTED[kind].ticketed);
      checked += 1;
    }
    expect(checked).toBe(Object.keys(EXPECTED).length);
  });
});
