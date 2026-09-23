import { describe, expect, it } from "vitest";
import { relativeCalendarDays } from "./formatDate";

// The artboard's `relDays` (dc.html:8972-8979), kept to its five cases and its
// exact wording. M26 link 9d / DRIFT D6.
describe("relativeCalendarDays", () => {
  it("names the three days either side of today, and counts the rest", () => {
    const today = "2026-08-04";
    expect(relativeCalendarDays("2026-08-04", today)).toBe("today");
    expect(relativeCalendarDays("2026-08-05", today)).toBe("tomorrow");
    expect(relativeCalendarDays("2026-08-03", today)).toBe("yesterday");
    expect(relativeCalendarDays("2026-08-06", today)).toBe("in 2 days");
    expect(relativeCalendarDays("2026-08-02", today)).toBe("2 days ago");
  });

  // The artboard's own numbers: TODAY = 2026-08-04, NEXT_TRIP_START =
  // 2026-09-20, `nextTripIn` = "in 47 days".
  it("gives the handoff's own 47 days for the handoff's own dates", () => {
    expect(relativeCalendarDays("2026-09-20", "2026-08-04")).toBe("in 47 days");
  });

  // **Whole days across a DST transition**, which is the answer being asserted
  // rather than the mechanism. Stated honestly because the obvious claim is
  // wrong: local-time arithmetic plus `Math.round` survives these too — an hour
  // of error over a span of days never changes the answer — and this test was
  // watched to PASS against a deliberately local-time implementation. It holds
  // the outcome, not the UTC; see `relativeCalendarDays`'s own note for what
  // the UTC actually buys.
  it("counts whole days across a DST transition", () => {
    // US spring forward (2026-03-08) — 30 days either way.
    expect(relativeCalendarDays("2026-03-23", "2026-02-21")).toBe("in 30 days");
    // EU autumn back (2026-10-25).
    expect(relativeCalendarDays("2026-11-09", "2026-10-10")).toBe("in 30 days");
    // And the boundary itself, where a 25-hour day would round to 0.
    expect(relativeCalendarDays("2026-03-09", "2026-03-08")).toBe("tomorrow");
    expect(relativeCalendarDays("2026-10-26", "2026-10-25")).toBe("tomorrow");
  });

  it("crosses a year end without arithmetic of its own", () => {
    expect(relativeCalendarDays("2027-01-01", "2026-12-31")).toBe("tomorrow");
    expect(relativeCalendarDays("2027-01-10", "2026-12-31")).toBe("in 10 days");
  });

  // An invented countdown beside a real date is worse than no countdown — and
  // `Date.UTC` rolls a nonsense month over into a real date rather than
  // refusing, which is why the parts are re-derived.
  it("returns null rather than a wrong number", () => {
    expect(relativeCalendarDays("not-a-date", "2026-08-04")).toBeNull();
    expect(relativeCalendarDays("2026-08-04", "nope")).toBeNull();
    expect(relativeCalendarDays("2026-13-01", "2026-08-04")).toBeNull();
    expect(relativeCalendarDays("2026-02-30", "2026-08-04")).toBeNull();
    expect(relativeCalendarDays("2026-08", "2026-08-04")).toBeNull();
  });
});
