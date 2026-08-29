import { describe, expect, it } from "vitest";
import { daySpan, deriveDayDates } from "../src/trip/dates";

// KI-73. `packages/domain/src/trip/dates.ts` and `apps/web/src/lib/dates.ts`
// are the same ISO-date parser written twice — they must be, because
// AGENTS.md's module map forbids UI code importing `@tc/domain` and this math
// is needed on both sides, so neither can import the other. Nothing in the
// type system makes them agree.
//
// This file and `apps/web/src/lib/dates.equivalence.test.ts` are what makes
// them agree: ONE corpus, duplicated verbatim, asserted against each side's
// own implementation. A change that moves one parser and not the other turns
// one of these two files red.
//
// Before 2026-08-29 the domain used `Date.UTC(y, m - 1, d)` and failed every
// REJECT row below — it rolled each impossible date over to a different REAL
// date and returned it silently — plus the `0026-01-01` row, which it mapped
// to 1926-01-01 (`Date.UTC(26, ...)` means 1926). Every input here is one
// `TripDate` accepts: it validates shape only (`/^\d{4}-\d{2}-\d{2}$/`,
// packages/contracts/src/trip.ts), with no calendar-range check.
//
// KEEP IN SYNC with the web copy. If you edit this table, edit that one.
const REJECT = "REJECT" as const;

const CORPUS: ReadonlyArray<readonly [input: string, expected: string | typeof REJECT]> = [
  // Rolled over silently under `Date.UTC`; the comment names what it became.
  ["2026-13-45", REJECT], // -> 2027-02-14
  ["2026-02-30", REJECT], // -> 2026-03-02
  ["2026-01-32", REJECT], // -> 2026-02-01
  ["2026-00-10", REJECT], // -> 2025-12-10
  ["2027-02-29", REJECT], // -> 2027-03-01 (2027 is not a leap year)
  ["2026-06-31", REJECT], // -> 2026-07-01 (June has 30 days)
  // Not even shape-valid; both mechanisms already refused these.
  ["2026-1", REJECT],
  ["", REJECT],
  // Real dates, including the nearest neighbour of each rejection above.
  ["2026-01-01", "2026-01-01"],
  ["2026-02-28", "2026-02-28"],
  ["2028-02-29", "2028-02-29"], // 2028 IS a leap year
  ["2026-06-30", "2026-06-30"],
  ["2026-12-31", "2026-12-31"],
  // The two-digit-year trap: `Date.UTC(26, 0, 1)` is 1926, so the century was
  // silently thrown away. A four-digit string year must stay put.
  ["0026-01-01", "0026-01-01"],
  ["0099-12-31", "0099-12-31"],
  ["0100-01-01", "0100-01-01"],
];

// Add-days agreement, asserted as `[input, days, expected]` on both sides.
// KEEP IN SYNC with the web copy.
const ADD_DAYS: ReadonlyArray<readonly [input: string, days: number, expected: string]> = [
  ["2026-03-10", 3, "2026-03-13"],
  ["2026-01-31", 1, "2026-02-01"],
  ["2026-12-31", 1, "2027-01-01"],
  ["2028-02-28", 1, "2028-02-29"],
  ["2027-02-28", 1, "2027-03-01"],
  ["0026-12-31", 1, "0027-01-01"],
];

describe("ISO date parsing agrees with apps/web/src/lib/dates.ts (KI-73)", () => {
  // `deriveDayDates(iso, 1)[0]` is the domain's parse-and-reformat round trip:
  // day 1 is pinned to the start date, so it is exactly `addDaysIso(iso, 0)`.
  it.each(CORPUS)("deriveDayDates round-trips %s", (input, expected) => {
    if (expected === REJECT) {
      expect(() => deriveDayDates(input, 1)).toThrow(RangeError);
    } else {
      expect(deriveDayDates(input, 1)).toEqual([expected]);
    }
  });

  it.each(CORPUS)("daySpan parses %s the same way", (input, expected) => {
    if (expected === REJECT) {
      expect(() => daySpan(input, "2026-01-01")).toThrow(RangeError);
      expect(() => daySpan("2026-01-01", input)).toThrow(RangeError);
    } else {
      // A single day spans itself inclusively, whatever the year.
      expect(daySpan(input, input)).toBe(1);
    }
  });

  it.each(ADD_DAYS)("deriveDayDates(%s)[%i] === %s", (input, days, expected) => {
    expect(deriveDayDates(input, days + 1)[days]).toBe(expected);
  });

  // The specific defect the entry measured, stated as itself: an impossible
  // date must not come back as a different real one.
  it("never rolls an impossible date over to a real one", () => {
    expect(() => deriveDayDates("2026-02-30", 1)).toThrow(RangeError);
    expect(() => deriveDayDates("2026-13-45", 1)).toThrow(RangeError);
  });

  // The century must survive. This is the one row where BOTH mechanisms
  // returned a date and they still disagreed, so a throw/no-throw test would
  // have missed it entirely.
  it("keeps a four-digit year below 100 instead of remapping it to 19xx", () => {
    expect(deriveDayDates("0026-01-01", 1)).toEqual(["0026-01-01"]);
    expect(daySpan("0026-01-01", "0026-01-31")).toBe(31);
  });
});
