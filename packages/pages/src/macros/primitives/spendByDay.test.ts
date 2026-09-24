import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ActivityTag, Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import type { SpendByDayPayload } from "../../chartPayloads";
import { costOfStops, narrow } from "../../select";
import { witness } from "../../test-support/witness";

// "Spend by day" — the first chart. What a reader cannot check from the picture
// is whether the bars are the SAME money the rest of the notebook reports, so
// most of this is that: a stop counted once however many tags it has, a yen
// cost kept off a dollar axis and named instead, and a backlog stop kept off
// every day.

const contextOf = (trip: TripDetail | undefined): WidgetContext => ({
  trip,
  page: { tripId: trip?.tripId ?? "t" },
  user: null,
  globals: null,
  today: null,
});

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

/** Three dated days of two stops, one parked idea, nothing priced. */
function tripOf(): TripDetail {
  const trip = tripDetailFactory.build(
    {},
    { transient: { dayCount: 3, activitiesPerDay: 2, unscheduledCount: 1 } },
  );
  trip.days = trip.days.map((day, i) => ({ ...day, date: `2026-08-0${i + 1}` }));
  return trip;
}

/** Price stop `slot` of day `day` (or the backlog when `day` is null). */
function price(trip: TripDetail, day: number | null, slot: number, cost: Money, tags: ActivityTag[] = []) {
  const id = day === null ? trip.backlog[slot]! : trip.days[day]!.activityIds[slot]!;
  trip.activities[id] = { ...trip.activities[id]!, cost, tags };
}

function chartOf(trip: TripDetail, params: Record<string, unknown> = {}): SpendByDayPayload {
  const outcome = renderMacro(contextOf(trip), "cost.chart", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-day") {
    throw new Error(`expected a spend-by-day block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

const barTotal = (bar: SpendByDayPayload["days"][number]) =>
  Object.values(bar.amounts).reduce((a, b) => a + b, 0);

describe("cost.chart — spend by day", () => {
  it("draws a bar for every day, the unpriced ones included, stacked by tag", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(4000), ["meal"]);
    price(trip, 0, 1, usd(20000), ["lodging"]);
    price(trip, 2, 0, usd(1500));
    const chart = chartOf(trip);

    expect(chart.days.map((bar) => bar.label)).toEqual(["Day 1", "Day 2", "Day 3"]);
    expect(chart.days[0]!.amounts).toMatchObject({ meal: 4000, lodging: 20000, untagged: 0 });
    expect(chart.days[0]!.breakdown).toBe("Meal $40.00, Lodging $200.00");
    expect(chart.days[1]!.total).toBeNull();
    expect(chart.days[2]!.amounts.untagged).toBe(1500);
    // Only the stacks that carry money get a key in the legend.
    expect(chart.series.map((s) => s.key)).toEqual(["meal", "lodging", "untagged"]);
  });

  it("counts a stop with two tags once, under the first", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(3000), ["meal", "outdoors"]);
    const bar = chartOf(trip).days[0]!;
    expect(bar.amounts).toMatchObject({ meal: 3000, outdoors: 0 });
    expect(bar.total).toBe("$30.00");
  });

  it("stacks a stop under the tag the widget is filtered to, not its first tag", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(3000), ["meal", "outdoors"]);
    price(trip, 0, 1, usd(9000), ["lodging"]);
    const bar = chartOf(trip, { tag: "outdoors" }).days[0]!;
    expect(bar.amounts).toMatchObject({ meal: 0, outdoors: 3000, lodging: 0 });
  });

  it("charts only the trip's currency, and names what it left out", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(5000));
    price(trip, 0, 1, { amountMinor: 1200000, currency: "JPY" });
    const chart = chartOf(trip);
    expect(barTotal(chart.days[0]!)).toBe(5000);
    expect(chart.notCharted).toContain("¥12,000.00");
  });

  it("leaves unscheduled stops off every day, and says so", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(5000));
    price(trip, null, 0, usd(7000));
    const chart = chartOf(trip);
    expect(chart.days.map(barTotal)).toEqual([5000, 0, 0]);
    expect(chart.notCharted).toContain("$70.00 unscheduled");
  });

  it("draws the budget spread evenly over the trip's days", () => {
    const trip = tripOf();
    trip.budget = usd(90000);
    price(trip, 0, 0, usd(5000));
    expect(chartOf(trip).budgetPerDay).toEqual({ amountMinor: 30000, text: "$300.00" });

    trip.budget = null;
    expect(chartOf(trip).budgetPerDay).toBeNull();
  });

  it("keeps the budget line per TRIP day when a date range narrows the bars", () => {
    const trip = tripOf();
    trip.budget = usd(90000);
    price(trip, 1, 0, usd(5000));
    const chart = chartOf(trip, { dates: { from: "2026-08-02", through: "2026-08-03" } });
    expect(chart.days.map((bar) => bar.label)).toEqual(["Day 2", "Day 3"]);
    expect(chart.budgetPerDay?.amountMinor).toBe(30000);
  });

  it("puts the axis above both the tallest bar and the budget line", () => {
    const trip = tripOf();
    trip.budget = usd(90000);
    price(trip, 0, 0, usd(41000));
    const { ticks } = chartOf(trip);
    expect(ticks[0]).toEqual({ value: 0, text: "$0.00" });
    expect(ticks.at(-1)!.value).toBeGreaterThanOrEqual(41000);
  });

  it("is empty when nothing is priced, and says why when only another currency is", () => {
    const trip = tripOf();
    expect(renderMacro(contextOf(trip), "cost.chart", {})).toEqual({ status: "empty" });
    price(trip, 0, 0, { amountMinor: 1200000, currency: "JPY" });
    expect(renderMacro(contextOf(trip), "cost.chart", {})).toEqual({
      status: "empty",
      because: "only priced in other currencies: ¥12,000.00",
    });
  });

  // Trip-currency money on no day is still money: "no costs yet" over $70 of
  // parked ideas would be the chart denying what the notCharted line admits.
  it("says what is priced when none of it is on a day", () => {
    const trip = tripOf();
    price(trip, null, 0, usd(7000));
    expect(renderMacro(contextOf(trip), "cost.chart", {})).toEqual({
      status: "empty",
      because: "nothing priced on a day yet: $70.00 unscheduled",
    });
    price(trip, 0, 0, { amountMinor: 1200000, currency: "JPY" });
    expect(renderMacro(contextOf(trip), "cost.chart", {})).toEqual({
      status: "empty",
      because: "nothing priced on a day yet: ¥12,000.00 in other currencies; $70.00 unscheduled",
    });
  });

  it("needs a trip", () => {
    expect(renderMacro(contextOf(undefined), "cost.chart", {})).toEqual({ status: "unbound", needs: "trip", shape: expect.any(Array) });
  });
});

// The claim a chart of money has to keep for every trip, not the handful above:
// **a day's stacks add up to what `cost` says that day costs**, for its
// trip-currency stops. `costOfStops` is the one sum (ADR-039), and a stacking
// rule that double-counted a two-tag stop or dropped an untagged one would be a
// second answer that drifts from it.
describe("cost.chart properties", () => {
  const RUNS = 150;
  const stopArb = fc.record({
    amount: fc.option(fc.integer({ min: 0, max: 500_000 }), { nil: null }),
    currency: fc.constantFrom("USD", "USD", "USD", "JPY"),
    tags: fc.subarray(["meal", "lodging", "ticketed", "outdoors"] as ActivityTag[]),
  });

  it("stacks every day to the trip-currency sum of that day's stops", () => {
    const w = witness("spend by day sums");
    fc.assert(
      fc.property(fc.array(stopArb, { minLength: 6, maxLength: 6 }), (stops) => {
        const trip = tripOf();
        stops.forEach((stop, i) => {
          const id = trip.days[Math.floor(i / 2)]!.activityIds[i % 2]!;
          trip.activities[id] = {
            ...trip.activities[id]!,
            cost: stop.amount === null ? null : { amountMinor: stop.amount, currency: stop.currency },
            tags: stop.tags,
          };
        });
        const outcome = renderMacro(contextOf(trip), "cost.chart", {});
        const selection = narrow(trip, null, {});
        if (selection.status !== "ok") throw new Error("an unfiltered selection cannot refuse");
        const expected = trip.days.map((_, day) =>
          costOfStops(
            selection.value.stops.filter((s) => s.dayIndex === day && s.activity.cost?.currency === trip.currency),
          ),
        );
        if (expected.every((sum) => sum === 0)) {
          expect(outcome.status).toBe("empty");
        } else {
          if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-day") {
            throw new Error(`expected a chart, got ${outcome.status}`);
          }
          expect(outcome.rendered.block.days.map(barTotal)).toEqual(expected);
        }
        w.tick();
      }),
      { numRuns: RUNS },
    );
    // Both branches assert, so every run ticks: the floor is exact.
    w.atLeast(RUNS);
  });
});
