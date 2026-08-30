import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SavedStop } from "@tc/contracts";
import { savedDayFacts } from "./savedDayFacts";
import { witness } from "@/test-support/witness";

function stop(over: Partial<SavedStop> = {}): SavedStop {
  return {
    title: "Stop",
    timeWindow: null,
    location: null,
    notes: null,
    anchors: [],
    kind: "planned",
    tags: [],
    cost: null,
    ...over,
  };
}

describe("savedDayFacts", () => {
  it("spans the first timed start to the last timed end", () => {
    const facts = savedDayFacts([
      stop({ timeWindow: { start: "07:30", end: "09:30" } }),
      stop({ timeWindow: { start: "12:30", end: "13:30" } }),
      stop({ timeWindow: { start: "17:00", end: "18:30" } }),
    ]);
    expect(facts.window).toEqual({ start: "07:30", end: "18:30" });
    expect(facts.stopCount).toBe(3);
  });

  // An untimed stop must not widen the window. Reading it as 00:00 would make
  // every day with one unplaced stop claim to start at midnight.
  it("ignores untimed stops when bounding the window", () => {
    const facts = savedDayFacts([
      stop(),
      stop({ timeWindow: { start: "09:00", end: "10:00" } }),
      stop(),
    ]);
    expect(facts.window).toEqual({ start: "09:00", end: "10:00" });
    expect(facts.stopCount).toBe(3);
  });

  it("has no window at all when nothing is timed", () => {
    expect(savedDayFacts([stop(), stop()]).window).toBeNull();
  });

  it("sums the priced stops and counts the rest", () => {
    const facts = savedDayFacts([
      stop({ cost: { amountMinor: 2_500, currency: "USD" } }),
      stop(),
      stop({ cost: { amountMinor: 4_000, currency: "USD" } }),
    ]);
    expect(facts.budgetPerPerson).toEqual({ amountMinor: 6_500, currency: "USD" });
    expect(facts.unpricedStops).toBe(1);
  });

  it("says nothing rather than something false when currencies disagree", () => {
    const facts = savedDayFacts([
      stop({ cost: { amountMinor: 2_500, currency: "USD" } }),
      stop({ cost: { amountMinor: 4_000, currency: "JPY" } }),
    ]);
    expect(facts.budgetPerPerson).toBeNull();
    // The stops are still counted as priced — the refusal is about the SUM,
    // not about whether the day says anything about money.
    expect(facts.unpricedStops).toBe(0);
  });

  it("reports no budget for a day where nothing is priced", () => {
    expect(savedDayFacts([stop(), stop()]).budgetPerPerson).toBeNull();
  });

  it("is empty-safe", () => {
    expect(savedDayFacts([])).toEqual({
      stopCount: 0,
      window: null,
      budgetPerPerson: null,
      unpricedStops: 0,
    });
  });

  // "For ALL single-currency days, the budget is the sum of the priced stops
  // and nothing is lost" — a claim over every input, so a property test.
  it("sums every priced stop, for any single-currency day", () => {
    const w = witness("single-currency budget");
    const money = fc.record({ amountMinor: fc.integer({ min: 0, max: 1_000_000 }) });
    fc.assert(
      fc.property(
        fc.constantFrom("USD", "JPY", "EUR"),
        fc.array(fc.option(money, { nil: null }), { minLength: 0, maxLength: 12 }),
        (currency, costs) => {
          const stops = costs.map((c) =>
            stop({ cost: c === null ? null : { amountMinor: c.amountMinor, currency } }),
          );
          const facts = savedDayFacts(stops);
          const priced = costs.filter((c): c is { amountMinor: number } => c !== null);
          const expected = priced.reduce((sum, c) => sum + c.amountMinor, 0);

          expect(facts.stopCount).toBe(stops.length);
          expect(facts.unpricedStops).toBe(stops.length - priced.length);
          if (priced.length === 0) expect(facts.budgetPerPerson).toBeNull();
          else expect(facts.budgetPerPerson).toEqual({ amountMinor: expected, currency });
          w.tick();
          return true;
        },
      ),
      { numRuns: 200 },
    );
    // No guard clause in the property, so it ticks exactly `numRuns` times —
    // the one case witness.ts says may use the run count exactly.
    w.atLeast(200);
  });
});
