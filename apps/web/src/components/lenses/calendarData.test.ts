import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { tripDetailFixture } from "@tc/factories";
import { calendarMonths } from "./calendarData";
import { witness } from "@/test-support/witness";

const uuid = (n: number) => `7d9a1f8e-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Nov 27 2022 is a Sunday, and Nov 30 2022 lands on a Wednesday — the one week
// (Sun Nov 27 – Sat Dec 3) that straddles the month boundary with real days on
// both sides. A 10-day trip from there crosses into December with more than a
// single week of trailing days, giving both blocks something to trim.
function novemberToDecemberTrip(dayCount = 10) {
  return tripDetailFixture({
    startDate: "2022-11-27",
    days: Array.from({ length: dayCount }, (_, i) => {
      const dt = new Date(Date.UTC(2022, 10, 27 + i));
      return { dayId: uuid(i), activityIds: [], date: dt.toISOString().slice(0, 10), costSubtotal: 0 };
    }),
  });
}

describe("calendarMonths", () => {
  it("groups a trip that crosses a month boundary into two blocks", () => {
    const months = calendarMonths(novemberToDecemberTrip());
    expect(months.map((m) => m.label)).toEqual(["November 2022", "December 2022"]);
  });

  it("names the days each month holds", () => {
    const months = calendarMonths(novemberToDecemberTrip());
    expect(months[0]!.note).toBe("Day 1 – Day 4");
    expect(months[1]!.note).toBe("Day 5 – Day 10");
  });

  it("does not render weeks before the trip's first week", () => {
    const months = calendarMonths(novemberToDecemberTrip());
    expect(months[0]!.cells).toHaveLength(7); // one week, not the whole of November
  });

  it("names a bare single day when a month holds only one", () => {
    // A trip that only touches December for its last day: Nov 27 – Dec 1 (5 days).
    const months = calendarMonths(novemberToDecemberTrip(5));
    expect(months[1]!.note).toBe("Day 5");
  });

  it("marks the trip day with its ordinal and activities; padding days are not in-trip", () => {
    const dayId = uuid(0);
    const activityId = uuid(1);
    const detail = tripDetailFixture({
      startDate: "2026-10-12",
      days: [{ dayId, activityIds: [activityId], date: "2026-10-12", costSubtotal: 0 }],
    });
    const months = calendarMonths(detail);
    expect(months).toHaveLength(1);
    const cells = months[0]!.cells;
    const tripCell = cells.find((c) => !c.blank && c.date === "2026-10-12");
    expect(tripCell).toMatchObject({ inTrip: true, ordinal: 1, activityIds: [activityId] });
    for (const cell of cells) {
      if (cell.blank) continue;
      if (cell.date === "2026-10-12") continue;
      expect(cell.inTrip).toBe(false); // and therefore carries no `ordinal` at all — the type guarantees it
    }
  });

  it("gives a dated day its position in detail.days, not its position among dated days (sparse trip)", () => {
    // An undated day sits between two dated ones. The third day's ordinal must
    // stay 3 — its position in detail.days — not collapse to 2 by counting only
    // dated entries, which would make CalendarLens focus the wrong planning day.
    const detail = tripDetailFixture({
      startDate: "2026-01-01",
      days: [
        { dayId: uuid(0), activityIds: [], date: "2026-01-01", costSubtotal: 0 },
        { dayId: uuid(1), activityIds: [], date: null, costSubtotal: 0 },
        { dayId: uuid(2), activityIds: [], date: "2026-01-03", costSubtotal: 0 },
      ],
    });
    const months = calendarMonths(detail);
    const lastCell = months[0]!.cells.find((c) => !c.blank && c.date === "2026-01-03");
    expect(lastCell).toMatchObject({ inTrip: true, ordinal: 3 });
  });

  it("undated trip → no months", () => {
    const detail = tripDetailFixture({
      startDate: null,
      days: [{ dayId: uuid(0), activityIds: [], date: null, costSubtotal: 0 }],
    });
    expect(calendarMonths(detail)).toEqual([]);
  });

  it("a dated trip with no days → no months", () => {
    expect(calendarMonths(tripDetailFixture({ startDate: "2027-06-01", days: [] }))).toEqual([]);
  });

  // The month grouping's central invariant: every trip day is placed exactly
  // once, in ordinal order, and every block is padded out to whole weeks —
  // for ANY contiguous trip, not just the hand-picked boundary case above.
  it("places every trip day exactly once, in order, across whole-week blocks", () => {
    const w = witness("calendarMonths coverage");
    fc.assert(
      fc.property(
        fc.integer({ min: -3000, max: 3000 }), // days since epoch, trip start
        fc.integer({ min: 1, max: 45 }), // trip length
        (startEpochDay, dayCount) => {
          const start = new Date(startEpochDay * 86400000);
          const startIso = start.toISOString().slice(0, 10);
          const days = Array.from({ length: dayCount }, (_, i) => {
            const dt = new Date(start.getTime() + i * 86400000);
            return { dayId: uuid(i), activityIds: [], date: dt.toISOString().slice(0, 10), costSubtotal: 0 };
          });
          const months = calendarMonths(tripDetailFixture({ startDate: startIso, days }));

          w.tick();
          for (const month of months) {
            expect(month.cells.length % 7).toBe(0);
          }
          const ordinals = months
            .flatMap((m) => m.cells)
            .filter((c): c is Extract<typeof c, { inTrip: true }> => !c.blank && c.inTrip)
            .map((c) => c.ordinal);
          expect(ordinals).toEqual(Array.from({ length: dayCount }, (_, i) => i + 1));
        },
      ),
      { numRuns: 300 },
    );
    w.atLeast(300); // no guard clauses skip a case — every run ticks exactly once
  });

  // An editable Calendar grows a trip by a drop on a date after its end (M41
  // D2), so that date has to be on the grid. CodeRabbit, PR 395: a trip ending
  // on a Saturday, or on the last day of a month, rendered none.
  describe("room after the end", () => {
    function tripFrom(startIso: string, dayCount: number) {
      const start = new Date(`${startIso}T00:00:00Z`);
      return tripDetailFixture({
        startDate: startIso,
        days: Array.from({ length: dayCount }, (_, i) => {
          const dt = new Date(start.getTime() + i * 86400000);
          return { dayId: uuid(i), activityIds: [], date: dt.toISOString().slice(0, 10), costSubtotal: 0 };
        }),
      });
    }
    const datedCells = (months: ReturnType<typeof calendarMonths>) =>
      months.flatMap((m) => m.cells).filter((c): c is Extract<typeof c, { blank: false }> => !c.blank);

    // Thu 10 – Sat 12 June 2027: the last day closes its week.
    it("gives a trip ending on a Saturday the whole next week to drop on", () => {
      const cells = datedCells(calendarMonths(tripFrom("2027-06-10", 3), { roomAfterEnd: true }));
      const after = cells.filter((c) => c.date > "2027-06-12");
      expect(after.map((c) => c.date)).toEqual([
        "2027-06-13", "2027-06-14", "2027-06-15", "2027-06-16", "2027-06-17", "2027-06-18", "2027-06-19",
      ]);
      expect(after.every((c) => !c.inTrip)).toBe(true);
    });

    // Mon 29 – Wed 31 March 2027: the rest of the week is April's.
    it("renders the next month's block when the days after the end fall in it", () => {
      const months = calendarMonths(tripFrom("2027-03-29", 3), { roomAfterEnd: true });
      expect(months.map((m) => m.label)).toEqual(["March 2027", "April 2027"]);
      expect(months[1]!.note).toBe("");
      const april = datedCells([months[1]!]);
      expect(april.map((c) => c.date)).toEqual(["2027-04-01", "2027-04-02", "2027-04-03"]);
      expect(april.every((c) => !c.inTrip)).toBe(true);
    });

    it("renders nothing after a Saturday end without the option (read-only boards)", () => {
      const cells = datedCells(calendarMonths(tripFrom("2027-06-10", 3)));
      expect(cells.filter((c) => c.date > "2027-06-12")).toEqual([]);
      expect(cells.at(-1)?.date).toBe("2027-06-12");
    });
  });
});
