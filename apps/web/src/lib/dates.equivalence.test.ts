import { describe, expect, it } from "vitest";
import { addDaysIso, parseIsoDateUtc } from "@/lib/dates";
import { calendarMonths } from "@/components/lenses/calendarData";

// KI-73, the apps/web half. See `packages/domain/test/dates.equivalence.test.ts`
// for the full rationale: the domain and apps/web carry the same ISO-date
// parser twice because the module map forbids either importing the other, and
// these two files are the only thing keeping the copies honest.
//
// The corpus below is duplicated VERBATIM from the domain copy. KEEP IN SYNC:
// if you edit this table, edit that one.
//
// Before 2026-08-29 `calendarData.ts` carried a THIRD mechanism, `Date.UTC(y,
// m - 1, d)`, and would have failed every REJECT row plus the `0026-01-01`
// row. `lib/dates.ts` already passed them all — that disagreement, on input
// `TripDate` accepts, is the whole of KI-73.
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

// KEEP IN SYNC with the domain copy.
const ADD_DAYS: ReadonlyArray<readonly [input: string, days: number, expected: string]> = [
  ["2026-03-10", 3, "2026-03-13"],
  ["2026-01-31", 1, "2026-02-01"],
  ["2026-12-31", 1, "2027-01-01"],
  ["2028-02-28", 1, "2028-02-29"],
  ["2027-02-28", 1, "2027-03-01"],
  ["0026-12-31", 1, "0027-01-01"],
];

const isoOf = (d: Date): string => d.toISOString().slice(0, 10);

describe("ISO date parsing agrees with packages/domain/src/trip/dates.ts (KI-73)", () => {
  it.each(CORPUS)("parseIsoDateUtc round-trips %s", (input, expected) => {
    if (expected === REJECT) {
      expect(() => parseIsoDateUtc(input)).toThrow(RangeError);
    } else {
      expect(isoOf(parseIsoDateUtc(input))).toBe(expected);
    }
  });

  it.each(CORPUS)("addDaysIso parses %s the same way", (input, expected) => {
    if (expected === REJECT) {
      expect(() => addDaysIso(input, 0)).toThrow(RangeError);
    } else {
      expect(addDaysIso(input, 0)).toBe(expected);
    }
  });

  it.each(ADD_DAYS)("addDaysIso(%s, %i) === %s", (input, days, expected) => {
    expect(addDaysIso(input, days)).toBe(expected);
  });

  it("keeps a four-digit year below 100 instead of remapping it to 19xx", () => {
    expect(addDaysIso("0026-01-01", 0)).toBe("0026-01-01");
  });
});

// `calendarData.ts` was the third copy. It now imports `parseIsoDateUtc`, so
// these assert that the LENS agrees with the parser rather than re-deriving
// its own answer — the surface KI-73 said "would bite" if raw input ever
// reached both mechanisms without `deriveDayDates` normalising it first.
describe("calendarMonths uses the one parser (KI-73)", () => {
  const detailWith = (dates: string[]) =>
    ({
      startDate: dates[0]!,
      currency: "USD",
      days: dates.map((date, i) => ({ dayId: `d${i}`, activityIds: [], date, costSubtotal: 0 })),
      activities: [],
      conflicts: [],
    }) as unknown as Parameters<typeof calendarMonths>[0];

  it("refuses a calendar-invalid day date instead of silently redating the cell", () => {
    // Under the old `Date.UTC` copy this produced a March grid for a date the
    // caller wrote as February — a cell whose `date` was not the day's date.
    expect(() => calendarMonths(detailWith(["2026-02-30"]))).toThrow(RangeError);
  });

  it("labels a year below 100 with its real century, not 19xx", () => {
    // The month HEADER is built by this file's own month arithmetic while the
    // CELLS come from the parser, so before the fix these two disagreed inside
    // a single render: cells in 0026, header reading "January 1926".
    const months = calendarMonths(detailWith(["0026-01-01", "0026-01-02"]));
    expect(months).toHaveLength(1);
    expect(months[0]!.label).toBe("January 26");
    const dated = months[0]!.cells.filter((c) => !c.blank);
    // Witness floor: `every` is vacuously true on an empty array, so without
    // this the assertion below would still pass for a month with no dated
    // cells at all while claiming they are all in 0026.
    expect(dated.length).toBeGreaterThan(0);
    expect(dated.every((c) => !c.blank && c.date.startsWith("0026-"))).toBe(true);
  });

  // Regression guard for a defect this file's own KI-73 fix introduced and
  // review caught (PR #84). `utcFromParts` used to re-set the year AFTER
  // `Date.UTC` had already rolled the month into the next year, so
  // `addMonths(Dec 0026, +1)` returned 0026-01-01 instead of 0027-01-01 — a
  // month cursor moving BACKWARD, and `calendarMonths`' `while` loop never
  // terminating. A trip crossing a December in years 0-99 is the trigger.
  //
  // The timeout is the assertion: before the fix this test does not fail, it
  // hangs. Keep it small so a regression is a fast red, not a stuck suite.
  it("terminates across a year boundary below year 100 (PR #84 review)", { timeout: 5000 }, () => {
    const months = calendarMonths(detailWith(["0026-12-30", "0026-12-31", "0027-01-01", "0027-01-02"]));
    expect(months.map((m) => m.label)).toEqual(["December 26", "January 27"]);
  });

  // The same arithmetic on ordinary years, so the year shift cannot be
  // "correct below 100, wrong everywhere else" without this going red.
  it("still crosses an ordinary year boundary correctly", () => {
    const months = calendarMonths(detailWith(["2026-12-30", "2026-12-31", "2027-01-01"]));
    expect(months.map((m) => m.label)).toEqual(["December 2026", "January 2027"]);
  });
});
