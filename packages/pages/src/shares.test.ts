import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { apportionPercents, shareLabel } from "./shares";
import { witness } from "./test-support/witness";

// The Spend breakdown's promise (Mitchell, 2026-09-26: *"I would always cap
// math so it can never be 101%"*): whole-percent shares that add up to exactly
// 100, each honest to within a point, and a real cost never called "0%".

describe("apportionPercents", () => {
  it("gives three equal parts 34/33/33, the extra point to the first", () => {
    expect(apportionPercents([1, 1, 1])).toEqual([34, 33, 33]);
  });

  it("breaks a tie on the remainder by order, where rounding each would reach 101", () => {
    // 16.5 / 16.5 / 67: `Math.round` on each says 17 + 17 + 67 = 101.
    expect(apportionPercents([670, 165, 165])).toEqual([67, 17, 16]);
    expect(apportionPercents([165, 165, 670])).toEqual([17, 16, 67]);
  });

  it("gives one dominant part the whole but a point per sliver, and a sliver 0", () => {
    expect(apportionPercents([1_000_000, 100, 100])).toEqual([100, 0, 0]);
    expect(apportionPercents([9_700, 150, 150])).toEqual([97, 2, 1]);
  });

  it("gives a single part 100, and a zero part 0", () => {
    expect(apportionPercents([4200])).toEqual([100]);
    expect(apportionPercents([0, 4200, 0])).toEqual([0, 100, 0]);
  });

  it("has no shares when there is nothing to share", () => {
    expect(apportionPercents([0, 0, 0])).toBeNull();
    expect(apportionPercents([])).toBeNull();
  });

  it("refuses an amount that is not a nonnegative integer, or a total past exact arithmetic", () => {
    expect(() => apportionPercents([1, -1])).toThrow(RangeError);
    expect(() => apportionPercents([1.5])).toThrow(RangeError);
    expect(() => apportionPercents([Number.MAX_SAFE_INTEGER])).toThrow(RangeError);
  });
});

describe("shareLabel", () => {
  it("says a whole percent, '<1%' for money that apportioned to 0, and nothing for no money", () => {
    expect(shareLabel(3300, 33)).toBe("33%");
    expect(shareLabel(100, 0)).toBe("<1%");
    expect(shareLabel(0, 0)).toBeNull();
  });
});

describe("apportionPercents properties", () => {
  const RUNS = 300;

  it("shares are whole percents in 0..100 that sum to exactly 100, each within 1 of exact", () => {
    const w = witness("apportioned shares");
    // Up to eight parts, some of them zero, some slivers beside large amounts.
    const amountArb = fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 100 }), fc.integer({ min: 0, max: 10_000_000 }));
    fc.assert(
      fc.property(fc.array(amountArb, { minLength: 1, maxLength: 8 }).filter((a) => a.some((x) => x > 0)), (amounts) => {
        const total = amounts.reduce((sum, a) => sum + a, 0);
        const shares = apportionPercents(amounts)!;
        expect(shares).toHaveLength(amounts.length);
        for (const [i, share] of shares.entries()) {
          expect(Number.isInteger(share)).toBe(true);
          expect(share).toBeGreaterThanOrEqual(0);
          expect(share).toBeLessThanOrEqual(100);
          // |share - amount*100/total| < 1, kept in integers.
          expect(Math.abs(share * total - amounts[i]! * 100)).toBeLessThan(total);
          if (amounts[i] === 0) expect(share).toBe(0);
        }
        expect(shares.reduce((sum, s) => sum + s, 0)).toBe(100);
        w.tick();
      }),
      { numRuns: RUNS },
    );
    // No guard clause after the filter: every run asserts.
    w.atLeast(RUNS);
  });
});
