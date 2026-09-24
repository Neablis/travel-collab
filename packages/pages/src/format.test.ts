import { describe, expect, it } from "vitest";
import { formatMoney, formatDate, formatCountdown, toClockLabel, toClockRange } from "./format";

describe("format helpers", () => {
  it("formats minor units to 2 decimals with currency", () => {
    expect(formatMoney(123456, "USD")).toBe("$1,234.56");
    expect(formatMoney(0, "USD")).toBe("$0.00");
  });
  it("formats a plain non-USD currency by code", () => {
    expect(formatMoney(5000, "EUR")).toContain("50.00");
  });
  // `amountMinor` is hundredths for EVERY currency in this codebase — the money
  // input multiplies by 100, the AI prompt says to, and every reader divides by
  // 100 (ADR-008, amended 2026-09-07). `Intl` does not know that: left to
  // itself it applies ISO 4217's exponent, which is 0 for JPY, so it read
  // hundredths as whole yen and rendered 123456 as `¥1,235` while the board's
  // own formatter rendered the same field `¥1,234.56` on the next screen over
  // (KI-2026-09-05-y / F-G04). These expectations are the board's output
  // verbatim — the same values are pinned from the other side in
  // `apps/web/src/components/lenses/formatMoney.test.ts`, and the two files are
  // what make a notebook `cost` widget and the board agree.
  it("renders a zero-exponent currency in hundredths too, matching the board", () => {
    expect(formatMoney(123456, "JPY")).toBe("¥1,234.56");
    expect(formatMoney(100, "JPY")).toBe("¥1.00");
    expect(formatMoney(150, "JPY")).toBe("¥1.50");
  });
  it("formats an ISO date; passes through null as an em dash", () => {
    expect(formatDate("2026-08-01")).toBe("Aug 1, 2026");
    expect(formatDate(null)).toBe("—");
  });
});

// `formatCountdown(today, first, last)` — every branch, on fixed dates.
//
// **Fixed dates are the whole point.** A countdown asserted against the day the
// suite runs is a test whose answer changes overnight and whose failure mode is
// a red build on a Tuesday. `today` is a parameter precisely so it can be
// moved instead of the clock (Invariant 4 — "time is passed in").
describe("formatCountdown", () => {
  // A two-week trip, so "day N of M" has room to be wrong in both directions.
  const FIRST = "2026-08-01";
  const LAST = "2026-08-14";

  it("counts down in days before it starts", () => {
    expect(formatCountdown("2026-06-28", FIRST, LAST)).toBe("in 34 days");
    expect(formatCountdown("2026-07-30", FIRST, LAST)).toBe("in 2 days");
  });

  it("says tomorrow and today in words, not as a number of days", () => {
    // "in 1 days" is wrong and "in 0 days" is not a thing anybody says about
    // today. Both are one `>` away from being emitted by the general branch,
    // which is why they are asserted rather than assumed.
    expect(formatCountdown("2026-07-31", FIRST, LAST)).toBe("starts tomorrow");
    expect(formatCountdown(FIRST, FIRST, LAST)).toBe("starts today");
  });

  it("switches to which day of it you are on once it has started", () => {
    // Inclusive of both ends, which is how a person counts the days of their
    // own trip: the second day is day 2 of 14, not day 1.
    expect(formatCountdown("2026-08-02", FIRST, LAST)).toBe("day 2 of 14");
    // The last day is still the trip, not over. This is the boundary the
    // `toEnd >= 0` test decides, and the one an off-by-one would move.
    expect(formatCountdown(LAST, FIRST, LAST)).toBe("day 14 of 14");
  });

  it("says a one-day trip starts today on the day, and is over the day after", () => {
    // **"starts today" wins over "day 1 of N", and that is deliberate.** The
    // `toStart === 0` branch is checked before the during-the-trip one, so the
    // first morning of any trip reads "starts today" rather than "day 1 of 14"
    // — which is the sentence a person actually says on that morning. A
    // one-day trip therefore never reaches "day 1 of 1" at all.
    //
    // I wrote this test expecting "day 1 of 1" and the code was right.
    expect(formatCountdown(FIRST, FIRST, FIRST)).toBe("starts today");
    expect(formatCountdown("2026-08-01", "2026-08-01", "2026-08-14")).toBe("starts today");
    expect(formatCountdown("2026-08-02", FIRST, FIRST)).toBe("ended yesterday");
  });

  it("speaks in the past tense once it is over", () => {
    // A notebook outlives the trip it describes, so a finished trip must not
    // read as an upcoming one.
    expect(formatCountdown("2026-08-15", FIRST, LAST)).toBe("ended yesterday");
    expect(formatCountdown("2026-08-24", FIRST, LAST)).toBe("ended 10 days ago");
  });

  it("crosses a month, a year and a leap day without drifting", () => {
    // `Date.UTC` arithmetic rather than string maths, and this is what says so:
    // 2028 is a leap year, so Feb has 29 days and a naive 30-day month would be
    // one out here.
    expect(formatCountdown("2027-12-31", "2028-01-01", "2028-01-01")).toBe("starts tomorrow");
    expect(formatCountdown("2028-02-01", "2028-03-01", "2028-03-01")).toBe("in 29 days");
  });

  it("says nothing at all when a date is unparseable", () => {
    // `null`, not a phrase: the caller turns it into the widget's empty state,
    // and inventing "in 0 days" here would put a false fact on a page.
    expect(formatCountdown("not-a-date", FIRST, LAST)).toBeNull();
    expect(formatCountdown("2026-08-01", "", LAST)).toBeNull();
  });
});

// The house 12-hour clock, moved here from `apps/web/src/lib/time.ts` so a
// notebook widget can print it (Mitchell, PR #221 preview: "All times should
// be in AM/PM not military time"). `lib/time` re-exports it, and its own tests
// still run there against the re-export.
describe("toClockLabel", () => {
  it("drops the minutes on the hour", () => {
    expect(toClockLabel("13:00")).toBe("1 pm");
  });

  it("keeps the minutes otherwise, zero-padded", () => {
    expect(toClockLabel("10:30")).toBe("10:30 am");
    expect(toClockLabel("09:05")).toBe("9:05 am");
  });

  // The two hours where `h % 12` is 0 and a naive formatter renders "0".
  it("renders midnight and noon as 12", () => {
    expect(toClockLabel("00:00")).toBe("12 am");
    expect(toClockLabel("12:00")).toBe("12 pm");
    expect(toClockLabel("00:45")).toBe("12:45 am");
    expect(toClockLabel("23:59")).toBe("11:59 pm");
  });
});

describe("toClockRange", () => {
  it("joins two clock labels with a spaced en dash", () => {
    expect(toClockRange("09:00", "17:30")).toBe("9 am – 5:30 pm");
    expect(toClockRange("00:00", "12:00")).toBe("12 am – 12 pm");
  });
});
