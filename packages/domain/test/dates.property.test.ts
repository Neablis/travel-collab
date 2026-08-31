import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { deriveDayDates } from "../src";
import { witness } from "./support/witness";

const isoDate = fc
  .date({ min: new Date(Date.UTC(2000, 0, 1)), max: new Date(Date.UTC(2099, 11, 31)), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

describe("deriveDayDates", () => {
  it("null start → all null, length preserved", () => {
    const w = witness("null start propagates");
    fc.assert(fc.property(fc.nat({ max: 60 }), (n) => {
      // n === 0 compares [] to [], which any implementation satisfies.
      if (n > 0) w.tick();
      expect(deriveDayDates(null, n)).toEqual(Array.from({ length: n }, () => null));
    }));
    w.atLeast(46); // observed 93-97 runs with n > 0
  });

  it("day 0 is the start date; consecutive days differ by exactly one calendar day", () => {
    const utcMs = (iso: string): number => {
      const [y, m, d] = iso.split("-").map(Number);
      return Date.UTC(y!, m! - 1, d!);
    };
    // Ticks per consecutive-day comparison, not per run: n === 1 skips the loop
    // entirely and asserts only `dates[0] === start`, which says nothing about
    // day spacing — the actual claim this property is named for.
    const w = witness("consecutive day spacing");
    fc.assert(fc.property(isoDate, fc.integer({ min: 1, max: 60 }), (start, n) => {
      const dates = deriveDayDates(start, n) as string[];
      expect(dates[0]).toBe(start);
      for (let i = 1; i < n; i++) {
        w.tick();
        expect((utcMs(dates[i]!) - utcMs(dates[i - 1]!)) / 86_400_000).toBe(1);
      }
    }));
    w.atLeast(1180); // observed 2370-2943 day-pair comparisons
  });

  it("shifting the trip start forward by K then back by K reproduces the same day dates (drag-the-vacation identity)", () => {
    const w = witness("shift round-trip");
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
      // Was `expect(there).not.toBe(base)` — a tautology: two deriveDayDates
      // calls always return different array objects, so it held even if the
      // shift did nothing. Assert the values actually moved, which is the
      // claim, and only where it applies (k === 0 is the identity shift).
      if (k !== 0) {
        w.tick();
        expect(there).not.toEqual(base);
      }
    }));
    w.atLeast(46); // observed 93-99 runs with k != 0
  });
});
