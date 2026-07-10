import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveDayDates } from "../src";

const isoDate = fc
  .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2099, 11, 31)) })
  .map((d) => d.toISOString().slice(0, 10));

describe("deriveDayDates", () => {
  it("null start → all null, length preserved", () => {
    fc.assert(fc.property(fc.nat({ max: 60 }), (n) => {
      expect(deriveDayDates(null, n)).toEqual(Array.from({ length: n }, () => null));
    }));
  });

  it("day 0 is the start date; consecutive days differ by exactly one calendar day", () => {
    const utcMs = (iso: string): number => {
      const [y, m, d] = iso.split("-").map(Number);
      return Date.UTC(y!, m! - 1, d!);
    };
    fc.assert(fc.property(isoDate, fc.integer({ min: 1, max: 60 }), (start, n) => {
      const dates = deriveDayDates(start, n) as string[];
      expect(dates[0]).toBe(start);
      for (let i = 1; i < n; i++) {
        expect((utcMs(dates[i]!) - utcMs(dates[i - 1]!)) / 86_400_000).toBe(1);
      }
    }));
  });

  it("shifting the trip start forward by K then back by K reproduces the same day dates (drag-the-vacation identity)", () => {
    fc.assert(fc.property(isoDate, fc.integer({ min: 1, max: 30 }), fc.integer({ min: -20, max: 20 }), (start, n, k) => {
      const shift = (iso: string, days: number): string => {
        const [y, m, d] = iso.split("-").map(Number);
        const dt = new Date(Date.UTC(y!, m! - 1, d!));
        dt.setUTCDate(dt.getUTCDate() + days);
        return dt.toISOString().slice(0, 10);
      };
      const base = deriveDayDates(start, n);
      const there = deriveDayDates(shift(start, k), n);
      const back = deriveDayDates(shift(shift(start, k), -k), n);
      expect(back).toEqual(base);
      expect(there).not.toBe(base); // different array identity; values differ when k != 0
    }));
  });
});
