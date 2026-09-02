import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { SavedStop } from "@tc/contracts";
import { dayLength, savedDayFacts } from "./savedDayFacts";
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
    expect(facts.totalCost).toEqual({ amountMinor: 6_500, currency: "USD" });
    expect(facts.unpricedStops).toBe(1);
  });

  it("says nothing rather than something false when currencies disagree", () => {
    const facts = savedDayFacts([
      stop({ cost: { amountMinor: 2_500, currency: "USD" } }),
      stop({ cost: { amountMinor: 4_000, currency: "JPY" } }),
    ]);
    expect(facts.totalCost).toBeNull();
    // The stops are still counted as priced — the refusal is about the SUM,
    // not about whether the day says anything about money.
    expect(facts.unpricedStops).toBe(0);
  });

  it("reports no budget for a day where nothing is priced", () => {
    expect(savedDayFacts([stop(), stop()]).totalCost).toBeNull();
  });

  it("is empty-safe", () => {
    expect(savedDayFacts([])).toEqual({
      stopCount: 0,
      window: null,
      totalCost: null,
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
          if (priced.length === 0) expect(facts.totalCost).toBeNull();
          else expect(facts.totalCost).toEqual({ amountMinor: expected, currency });
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

// Mitchell, 2026-09-01: "also add length, with a tag short medium long if the
// duration is <4h, 4-12h, 12h+". The two edges are asserted from BOTH sides,
// because the spoken ranges overlap at exactly twelve hours and the seam is a
// decision this function makes rather than one the request settled — see its
// doc comment. If either of these four flips, the rail and the Discover card
// stop agreeing about the same day.
describe("dayLength", () => {
  it("is Short under four hours, and exactly four hours is Medium", () => {
    expect(dayLength({ start: "09:00", end: "09:30" })).toBe("short");
    // Both sides of the first edge, in one place: the "under" case and the
    // "at" case were separate tests repeating the same 12:59 assertion.
    expect(dayLength({ start: "09:00", end: "12:59" })).toBe("short");
    expect(dayLength({ start: "09:00", end: "13:00" })).toBe("medium");
  });

  it("puts exactly twelve hours in Medium, not Long", () => {
    expect(dayLength({ start: "08:00", end: "20:00" })).toBe("medium");
    expect(dayLength({ start: "08:00", end: "20:01" })).toBe("long");
  });

  it("is Long past twelve hours", () => {
    // Mitchell's own example from the rail: 8:20 am – 8:30 pm, 12 h 10 m.
    expect(dayLength({ start: "08:20", end: "20:30" })).toBe("long");
  });

  // A day with no times has no window and therefore no length. Rendering
  // "Short" here would state a fact about a day that says nothing about when
  // it runs — the same reason `savedDayFacts` returns a null window rather
  // than treating an untimed stop as midnight.
  it("has no length for a day with no window", () => {
    expect(dayLength(null)).toBeNull();
    expect(dayLength(savedDayFacts([stop(), stop()]).window)).toBeNull();
  });

  // Stored order, not clock order — nothing forces the two to agree, and a
  // negative span must not fall through the comparisons to an arbitrary answer.
  it("clamps a window that ends before it starts", () => {
    expect(dayLength({ start: "18:00", end: "09:00" })).toBe("short");
  });

  // The composed path the rail actually takes: stops in, tag out.
  it("reads the length off a real day's derived window", () => {
    const facts = savedDayFacts([
      stop({ timeWindow: { start: "08:20", end: "09:30" } }),
      stop({ timeWindow: { start: "19:00", end: "20:30" } }),
    ]);
    expect(dayLength(facts.window)).toBe("long");
  });
});
