import { describe, expect, it } from "vitest";
import { ActivityKind } from "@tc/contracts";
import { needsBooking } from "./needsBooking";

// The rule as Mitchell decided it on 2026-09-25 (M28, ADR-054): exactly the
// `pending` stops. Enumerated over `ActivityKind.options` rather than a list
// written here, so a kind added to the contract fails the "every kind has an
// answer" line below until somebody decides what it means for booking.
const EXPECTED: Record<ActivityKind, boolean> = {
  planned: false,
  pending: true,
  transit: false,
};

describe("needsBooking", () => {
  it("answers every kind", () => {
    let checked = 0;
    for (const kind of ActivityKind.options) {
      expect(needsBooking({ kind }), kind).toBe(EXPECTED[kind]);
      checked += 1;
    }
    expect(checked).toBe(Object.keys(EXPECTED).length);
  });

  // The exception M28 removed: `planned` + `ticketed` used to count, because
  // `booked` was where a ticketed stop went once settled. A ticketed stop that
  // is not pending is settled now.
  it("does not count a ticketed stop that is not pending", () => {
    const ticketed = { kind: "planned" as const, tags: ["ticketed" as const] };
    expect(needsBooking(ticketed)).toBe(false);
  });
});
