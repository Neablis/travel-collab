import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ActivityKind, ActivityTag, Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import type { SpendByKindPayload } from "../../chartPayloads";
import { witness } from "../../test-support/witness";

// "Spend by kind" — the pie. What a reader cannot check from the picture is
// whether the slices are the SAME money the rest of the notebook reports, so
// this is mostly that: each slice is `cost{kind}` for the same filters, the
// filters narrow it, a yen cost stays off a dollar pie and is named, and a
// backlog stop is in it (it has no day axis to fall off).

const contextOf = (trip: TripDetail | undefined): WidgetContext => ({
  trip,
  page: { tripId: trip?.tripId ?? "t" },
  user: null,
  globals: null,
  today: null,
});

const usd = (amountMinor: number): Money => ({ amountMinor, currency: "USD" });

/** Three dated days of two stops, one parked stop, nothing priced, in USD. */
function tripOf(): TripDetail {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 3, activitiesPerDay: 2, unscheduledCount: 1 } });
  trip.currency = "USD";
  trip.days = trip.days.map((day, i) => ({ ...day, date: `2026-08-0${i + 1}` }));
  return trip;
}

/** Price stop `slot` of day `day` (or the backlog when `day` is null) and give it a kind. */
function price(trip: TripDetail, day: number | null, slot: number, cost: Money | null, kind: ActivityKind, tags: ActivityTag[] = []) {
  const id = day === null ? trip.backlog[slot]! : trip.days[day]!.activityIds[slot]!;
  trip.activities[id] = { ...trip.activities[id]!, cost, kind, tags };
}

function pieOf(trip: TripDetail, params: Record<string, unknown> = {}): SpendByKindPayload {
  const outcome = renderMacro(contextOf(trip), "cost.byKind", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-kind") {
    throw new Error(`expected a spend-by-kind block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("cost.byKind — spend by kind", () => {
  it("sums each kind's priced stops, lists every kind in order, and says each one's share", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(6000), "planned");
    price(trip, 0, 1, usd(1500), "pending");
    price(trip, 1, 0, usd(2500), "transit");
    price(trip, 1, 1, usd(4000), "planned");
    const pie = pieOf(trip);

    expect(pie.slices.map(({ key, label, amount, share }) => [key, label, amount, share])).toEqual([
      ["planned", "Planned", "$100.00", "71%"],
      ["pending", "Pending", "$15.00", "11%"],
      ["transit", "Travel", "$25.00", "18%"],
    ]);
    expect(pie.total).toBe("$140.00");
    expect(pie.summary).toBe("Spend by kind in USD: $140.00 — Planned $100.00 (71%), Pending $15.00 (11%), Travel $25.00 (18%).");
    expect(pie.notCharted).toBeNull();
  });

  it("keeps a kind nothing is priced on in the key, with no amount, and leaves it out of the sentence", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1000), "planned");
    price(trip, 0, 1, null, "pending");
    const pie = pieOf(trip);
    expect(pie.slices.map((s) => [s.key, s.amountMinor, s.amount, s.share])).toEqual([
      ["planned", 1000, "$10.00", "100%"],
      ["pending", 0, null, null],
      ["transit", 0, null, null],
    ]);
    expect(pie.summary).toBe("Spend by kind in USD: $10.00 — Planned $10.00 (100%).");
  });

  it("says a sliver is there rather than rounding it to 0%", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1_000_000), "planned");
    price(trip, 0, 1, usd(100), "transit");
    expect(pieOf(trip).slices.find((s) => s.key === "transit")!.share).toBe("<1%");
  });

  it("counts an unscheduled stop — a pie has no day for it to fall off", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1000), "planned");
    price(trip, null, 0, usd(3000), "pending");
    expect(pieOf(trip).slices.map((s) => s.amountMinor)).toEqual([1000, 3000, 0]);
  });

  it("narrows to a day, a date range or a tag through the same filters as the other cost widgets", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1000), "planned", ["meal"]);
    price(trip, 1, 0, usd(2000), "pending", ["meal"]);
    price(trip, 2, 0, usd(4000), "transit");
    price(trip, null, 0, usd(8000), "planned", ["meal"]);
    const amounts = (params: Record<string, unknown>) => pieOf(trip, params).slices.map((s) => s.amountMinor);

    expect(amounts({})).toEqual([9000, 2000, 4000]);
    expect(amounts({ day: { kind: "index", index: 1 } })).toEqual([0, 2000, 0]);
    expect(amounts({ dates: { from: "2026-08-02", through: "2026-08-03" } })).toEqual([0, 2000, 4000]);
    expect(amounts({ tag: "meal" })).toEqual([9000, 2000, 0]);
  });

  it("does not take a kind filter: a pie split by kind and narrowed to one is a single slice", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1000), "planned");
    price(trip, 0, 1, usd(2000), "pending");
    // Stripped on parse like any param the primitive does not declare.
    expect(pieOf(trip, { kind: "pending" }).slices.map((s) => s.amountMinor)).toEqual([1000, 2000, 0]);
  });

  it("charts only the trip's currency, and names what it left out", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1000), "planned");
    price(trip, 0, 1, { amountMinor: 1_200_000, currency: "JPY" }, "planned");
    const pie = pieOf(trip);
    expect(pie.slices[0]!.amountMinor).toBe(1000);
    expect(pie.total).toBe("$10.00");
    expect(pie.notCharted).toBe("Not charted: ¥12,000.00 in other currencies.");
  });

  it("is empty when nothing is priced, and says why when only another currency is", () => {
    const trip = tripOf();
    expect(renderMacro(contextOf(trip), "cost.byKind", {})).toEqual({ status: "empty" });
    price(trip, 0, 0, { amountMinor: 1_200_000, currency: "JPY" }, "pending");
    expect(renderMacro(contextOf(trip), "cost.byKind", {})).toEqual({
      status: "empty",
      because: "only priced in other currencies: ¥12,000.00",
    });
  });

  it("needs a trip", () => {
    expect(renderMacro(contextOf(undefined), "cost.byKind", {}).status).toBe("unbound");
  });
});

// The claim a chart of money has to keep for every trip: **each slice is what
// `cost` says that kind costs, and the total is what `cost` says the selection
// costs**, under the same filters — for a trip priced in its own currency,
// which is the only one `cost` sums honestly (KI-2026-09-24-p).
describe("cost.byKind properties", () => {
  const RUNS = 150;
  const KINDS: ActivityKind[] = ["planned", "pending", "transit"];
  const stopArb = fc.record({
    amount: fc.option(fc.integer({ min: 0, max: 500_000 }), { nil: null }),
    kind: fc.constantFrom(...KINDS),
    tags: fc.subarray(["meal", "lodging", "ticketed", "outdoors"] as ActivityTag[]),
  });
  const filterArb = fc.oneof(
    fc.constant({}),
    fc.integer({ min: 0, max: 2 }).map((index) => ({ day: { kind: "index", index } })),
    fc.constantFrom("meal", "lodging").map((tag) => ({ tag })),
    fc.constant({ dates: { from: "2026-08-02", through: "2026-08-03" } }),
  );

  it("slices to `cost{kind}` and totals to `cost`, under any filter", () => {
    const w = witness("spend by kind sums");
    fc.assert(
      fc.property(fc.array(stopArb, { minLength: 7, maxLength: 7 }), filterArb, (stops, filters) => {
        const trip = tripOf();
        stops.forEach((stop, i) => {
          const cost = stop.amount === null ? null : usd(stop.amount);
          if (i === 6) price(trip, null, 0, cost, stop.kind, stop.tags);
          else price(trip, Math.floor(i / 2), i % 2, cost, stop.kind, stop.tags);
        });
        const single = (params: Record<string, unknown>) => {
          const outcome = renderMacro(contextOf(trip), "cost", params);
          if (outcome.status === "empty") return null;
          if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") throw new Error(`cost said ${outcome.status}`);
          return outcome.rendered.segs.map((seg) => seg.text).join("");
        };
        const total = single(filters);
        if (total === null) {
          expect(renderMacro(contextOf(trip), "cost.byKind", filters).status).toBe("empty");
        } else {
          const pie = pieOf(trip, filters);
          expect(pie.total).toBe(total);
          expect(pie.slices.map((s) => s.amount)).toEqual(KINDS.map((kind) => single({ ...filters, kind })));
        }
        w.tick();
      }),
      { numRuns: RUNS },
    );
    // Both branches assert, so every run ticks: the floor is exact.
    w.atLeast(RUNS);
  });
});
