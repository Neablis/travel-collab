// The "All" rule's two claims that hold for every input, not just the cases
// in kinds.test.ts:
//
// 1. A summing or spanning collapse does not depend on the order of the stops.
//    "All stops" reads the same whichever way the day was sorted — including
//    for mixed currencies, which is why the per-currency parts are ordered by a
//    rule rather than by first appearance.
// 2. A listing collapse under `distinct` keeps exactly the set of values it was
//    given, each once, in first-appearance order.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Money } from "@tc/contracts";
import { collapseKind, formatKind } from "./kinds";
import { witness } from "./test-support/witness";

const RUNS = 200;
const ctxArb = fc.record({ currency: fc.constantFrom("USD", "EUR", "JPY") });

const moneyArb: fc.Arbitrary<Money | number> = fc.oneof(
  fc.integer({ min: 0, max: 10_000_000 }),
  fc.record({ amountMinor: fc.integer({ min: 0, max: 10_000_000 }), currency: fc.constantFrom("USD", "EUR", "JPY") }),
);
const dateArb = fc
  .date({ min: new Date(Date.UTC(2020, 0, 1)), max: new Date(Date.UTC(2030, 11, 31)), noInvalidDate: true })
  .map((d) => d.toISOString().slice(0, 10));

// A list and a reordering of it: shuffle by sorting on generated keys.
function withPermutation<T>(arb: fc.Arbitrary<T>) {
  return fc
    .array(fc.tuple(arb, fc.integer()), { maxLength: 12 })
    .map((pairs) => ({
      values: pairs.map(([v]) => v),
      shuffled: [...pairs].sort((a, b) => a[1] - b[1]).map(([v]) => v),
    }));
}

describe("collapseKind properties", () => {
  it("summing and spanning kinds are order-independent", () => {
    const w = witness("collapse order-independence");
    fc.assert(
      fc.property(
        ctxArb,
        withPermutation(moneyArb),
        withPermutation(fc.integer({ min: 0, max: 100_000 })),
        withPermutation(fc.integer({ min: 0, max: 10_000 })),
        withPermutation(dateArb),
        (ctx, money, counts, minutes, dates) => {
          expect(collapseKind("money", money.shuffled, ctx)).toBe(collapseKind("money", money.values, ctx));
          expect(collapseKind("count", counts.shuffled, ctx)).toBe(collapseKind("count", counts.values, ctx));
          expect(collapseKind("duration", minutes.shuffled, ctx)).toBe(collapseKind("duration", minutes.values, ctx));
          expect(collapseKind("date", dates.shuffled, ctx)).toBe(collapseKind("date", dates.values, ctx));
          w.tick();
        },
      ),
      { numRuns: RUNS },
    );
    // No guard clause above, so every run asserts: the floor is exact.
    w.atLeast(RUNS);
  });

  it("a single-currency money sum equals the formatted total", () => {
    const w = witness("money sum");
    fc.assert(
      fc.property(ctxArb, fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 1, maxLength: 12 }), (ctx, amounts) => {
        const total = amounts.reduce((a, b) => a + b, 0);
        expect(collapseKind("money", amounts, ctx)).toBe(formatKind("money", total, ctx));
        w.tick();
      }),
      { numRuns: RUNS },
    );
    w.atLeast(RUNS);
  });

  it("distinct keeps every value once, in first-appearance order", () => {
    const w = witness("distinct listing");
    const ctx = { currency: "USD" };
    fc.assert(
      fc.property(fc.array(fc.constantFrom("Kyoto", "Osaka", "Nara", "Kobe"), { minLength: 1, maxLength: 12 }), (values) => {
        const firstSeen = values.filter((v, i) => values.indexOf(v) === i);
        expect(collapseKind("text", values, ctx, { distinct: true })).toBe(firstSeen.join(", "));
        expect(collapseKind("text", values, ctx)).toBe(values.join(", "));
        w.tick();
      }),
      { numRuns: RUNS },
    );
    w.atLeast(RUNS);
  });
});
