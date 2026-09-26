import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { ActivityKind, ActivityTag, Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { WidgetContext } from "../../registry-types";
import type { SpendBreakdownPayload, SpendByDayPayload } from "../../chartPayloads";
import { formatMoney } from "../../format";
import { witness } from "../../test-support/witness";

// "Spend by kind" and "Spend by tag" — `cost.breakdown`'s two pies. What a
// reader cannot check from the picture is whether the slices are the SAME money
// the rest of the notebook reports, so this is mostly that: each kind slice is
// `cost{kind}` for the same filters, each tag slice is what "Spend by day"
// stacks under that tag, the filters narrow it, the filter on the slices' own
// dimension is ignored, a yen cost stays off a dollar pie and is named, and a
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

function pieOf(trip: TripDetail, params: Record<string, unknown> = {}): SpendBreakdownPayload {
  const outcome = renderMacro(contextOf(trip), "cost.breakdown", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-breakdown") {
    throw new Error(`expected a spend-breakdown block, got ${JSON.stringify(outcome)}`);
  }
  return outcome.rendered.block;
}

describe("cost.breakdown by kind — spend by kind", () => {
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

  it("ignores a kind filter: a pie split by kind and narrowed to one would be a single slice", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1000), "planned");
    price(trip, 0, 1, usd(2000), "pending");
    // Kept by the schema — `by: "tag"` takes it — and withheld under `by: "kind"`,
    // spelled or defaulted. The title does not claim a narrowing either.
    for (const params of [{ kind: "pending" }, { by: "kind", kind: "pending" }]) {
      const pie = pieOf(trip, params);
      expect(pie.slices.map((s) => s.amountMinor)).toEqual([1000, 2000, 0]);
      expect(pie.title).toBe("Spend by kind");
    }
  });

  it("says in its title what a tag, a day or dates narrowed it to", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(1000), "planned", ["meal"]);
    expect(pieOf(trip).title).toBe("Spend by kind");
    expect(pieOf(trip, { tag: "meal" }).title).toBe("Spend by kind · Meal");
    expect(pieOf(trip, { tag: "meal", day: { kind: "index", index: 0 } }).title).toBe("Spend by kind · Meal · Day 1");
    expect(pieOf(trip, { dates: { from: "2026-08-01", through: "2026-08-02" } }).title).toBe("Spend by kind · Aug 1 – Aug 2");
    // The picture's sentence starts with the same words.
    expect(pieOf(trip, { tag: "meal" }).summary).toBe("Spend by kind · Meal in USD: $10.00 — Planned $10.00 (100%).");
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
    expect(renderMacro(contextOf(trip), "cost.breakdown", {})).toEqual({ status: "empty" });
    price(trip, 0, 0, { amountMinor: 1_200_000, currency: "JPY" }, "pending");
    expect(renderMacro(contextOf(trip), "cost.breakdown", {})).toEqual({
      status: "empty",
      because: "only priced in other currencies: ¥12,000.00",
    });
  });

  it("needs a trip", () => {
    expect(renderMacro(contextOf(undefined), "cost.breakdown", {}).status).toBe("unbound");
  });
});

describe("cost.breakdown by tag — spend by tag", () => {
  it("files each stop under its first tag in the contract's order, and the rest as untagged", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(6000), "planned", ["meal"]);
    // Two tags: counted ONCE, under lodging — it comes before outdoors in the contract.
    price(trip, 0, 1, usd(2000), "planned", ["outdoors", "lodging"]);
    price(trip, 1, 0, usd(1000), "transit");
    price(trip, 1, 1, usd(1000), "pending", ["ticketed", "meal"]);
    const pie = pieOf(trip, { by: "tag" });

    expect(pie.by).toBe("tag");
    expect(pie.title).toBe("Spend by tag");
    expect(pie.slices.map(({ key, label, amount, share }) => [key, label, amount, share])).toEqual([
      ["meal", "Meal", "$70.00", "70%"],
      ["lodging", "Lodging", "$20.00", "20%"],
      ["ticketed", "Ticketed", null, null],
      ["outdoors", "Outdoors", null, null],
      ["untagged", "Untagged", "$10.00", "10%"],
    ]);
    expect(pie.total).toBe("$100.00");
    expect(pie.summary).toBe("Spend by tag in USD: $100.00 — Meal $70.00 (70%), Lodging $20.00 (20%), Untagged $10.00 (10%).");
  });

  it("narrows by kind, and says so in its title", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(6000), "planned", ["meal"]);
    price(trip, 0, 1, usd(2000), "pending", ["meal"]);
    price(trip, 1, 0, usd(1000), "pending");
    const pie = pieOf(trip, { by: "tag", kind: "pending" });
    expect(pie.slices.map((s) => s.amountMinor)).toEqual([2000, 0, 0, 0, 1000]);
    expect(pie.title).toBe("Spend by tag · Pending");
    expect(pie.total).toBe("$30.00");
  });

  it("reads a stored tag filter as no tag filter — a stored page that has both still opens, unnarrowed", () => {
    const trip = tripOf();
    price(trip, 0, 0, usd(6000), "planned", ["meal"]);
    price(trip, 0, 1, usd(2000), "planned", ["lodging"]);
    price(trip, 1, 0, usd(1000), "planned");
    const stored = pieOf(trip, { by: "tag", tag: "meal" });
    expect(stored).toEqual(pieOf(trip, { by: "tag" }));
    expect(stored.slices.map((s) => s.amountMinor)).toEqual([6000, 2000, 0, 0, 1000]);
    expect(stored.title).toBe("Spend by tag");
  });

  it("keeps the currency rule and the empty states of the kind pie", () => {
    const trip = tripOf();
    expect(renderMacro(contextOf(trip), "cost.breakdown", { by: "tag" })).toEqual({ status: "empty" });
    price(trip, 0, 0, { amountMinor: 1_200_000, currency: "JPY" }, "planned", ["meal"]);
    expect(renderMacro(contextOf(trip), "cost.breakdown", { by: "tag" })).toEqual({
      status: "empty",
      because: "only priced in other currencies: ¥12,000.00",
    });
    price(trip, 0, 1, usd(100), "planned", ["meal"]);
    price(trip, 1, 0, usd(1_000_000), "planned");
    const pie = pieOf(trip, { by: "tag" });
    expect(pie.slices[0]!.share).toBe("<1%");
    expect(pie.notCharted).toBe("Not charted: ¥12,000.00 in other currencies.");
  });
});

// The claim a chart of money has to keep for every trip: **each slice is what
// `cost` says that kind costs, and the total is what `cost` says the selection
// costs**, under the same filters — for a trip priced in its own currency,
// which is the only one `cost` sums honestly (KI-2026-09-24-p).
describe("cost.breakdown properties", () => {
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

  /** Seven stops: two on each of three days, then the backlog's one. */
  function pricedTrip(stops: readonly { amount: number | null; kind: ActivityKind; tags: ActivityTag[] }[]): TripDetail {
    const trip = tripOf();
    stops.forEach((stop, i) => {
      const cost = stop.amount === null ? null : usd(stop.amount);
      if (i === 6) price(trip, null, 0, cost, stop.kind, stop.tags);
      else price(trip, Math.floor(i / 2), i % 2, cost, stop.kind, stop.tags);
    });
    return trip;
  }

  /** What the inline `cost` widget prints for these filters; `null` when it is empty. */
  function single(trip: TripDetail, params: Record<string, unknown>): string | null {
    const outcome = renderMacro(contextOf(trip), "cost", params);
    if (outcome.status === "empty") return null;
    if (outcome.status !== "ok" || outcome.rendered.kind !== "inline") throw new Error(`cost said ${outcome.status}`);
    return outcome.rendered.segs.map((seg) => seg.text).join("");
  }

  // Any date range inside the three-day trip, from <= through.
  const datesArb = fc
    .tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }))
    .map(([a, b]) => ({ dates: { from: `2026-08-0${Math.min(a, b)}`, through: `2026-08-0${Math.max(a, b)}` } }));

  it("slices to `cost{kind}` and totals to `cost`, under any filter", () => {
    const w = witness("spend by kind sums");
    fc.assert(
      fc.property(fc.array(stopArb, { minLength: 7, maxLength: 7 }), filterArb, (stops, filters) => {
        const trip = pricedTrip(stops);
        const total = single(trip, filters);
        if (total === null) {
          expect(renderMacro(contextOf(trip), "cost.breakdown", filters).status).toBe("empty");
        } else {
          const pie = pieOf(trip, filters);
          expect(pie.total).toBe(total);
          expect(pie.slices.map((s) => s.amount)).toEqual(KINDS.map((kind) => single(trip, { ...filters, kind })));
        }
        w.tick();
      }),
      { numRuns: RUNS },
    );
    // Both branches assert, so every run ticks: the floor is exact.
    w.atLeast(RUNS);
  });

  it("by tag, slices sum to `cost` under any day, dates or kind filter — and ignore a tag filter", () => {
    const w = witness("spend by tag sums");
    const tagFilterArb = fc.record(
      {
        narrow: fc.oneof(
          fc.constant({}),
          fc.integer({ min: 0, max: 2 }).map((index) => ({ day: { kind: "index", index } })),
          fc.constantFrom(...KINDS).map((kind) => ({ kind })),
          datesArb,
        ),
        // A withheld tag filter, sometimes: it must change nothing.
        stale: fc.option(fc.constantFrom("meal", "lodging"), { nil: undefined }),
      },
    );
    fc.assert(
      fc.property(fc.array(stopArb, { minLength: 7, maxLength: 7 }), tagFilterArb, (stops, { narrow, stale }) => {
        const trip = pricedTrip(stops);
        const params = { by: "tag", ...narrow, ...(stale === undefined ? {} : { tag: stale }) };
        const total = single(trip, narrow);
        if (total === null) {
          expect(renderMacro(contextOf(trip), "cost.breakdown", params).status).toBe("empty");
        } else {
          const pie = pieOf(trip, params);
          expect(pie.total).toBe(total);
          expect(formatMoney(pie.slices.reduce((sum, s) => sum + s.amountMinor, 0), "USD")).toBe(total);
        }
        w.tick();
      }),
      { numRuns: RUNS },
    );
    w.atLeast(RUNS);
  });

  it("by tag, each slice is what Spend by day stacks under that tag, under any date range", () => {
    // The first-tag rule is ONE function (`spendSeries.ts`); this holds the two
    // charts to it. The backlog stop is left unpriced: the bars have no day for
    // it, and that difference is the bars' documented rule, not this one.
    const w = witness("spend by tag agrees with spend by day");
    fc.assert(
      fc.property(
        fc.array(stopArb, { minLength: 7, maxLength: 7 }),
        fc.oneof(fc.constant({}), datesArb),
        (stops, filters) => {
          const trip = pricedTrip(stops.map((stop, i) => (i === 6 ? { ...stop, amount: null } : stop)));
          const bars = renderMacro(contextOf(trip), "cost.chart", filters);
          const pie = renderMacro(contextOf(trip), "cost.breakdown", { by: "tag", ...filters });
          if (bars.status === "empty") {
            expect(pie.status).toBe("empty");
            return;
          }
          if (bars.status !== "ok" || bars.rendered.kind !== "block") throw new Error(`cost.chart said ${bars.status}`);
          const day = bars.rendered.block as SpendByDayPayload;
          const byTag = pieOf(trip, { by: "tag", ...filters });
          if (byTag.by !== "tag") throw new Error("expected a tag pie");
          for (const slice of byTag.slices) {
            expect(slice.amountMinor, slice.key).toBe(day.days.reduce((sum, bar) => sum + bar.amounts[slice.key], 0));
          }
          if (byTag.slices.filter((s) => s.amountMinor > 0).length > 1) w.tick();
        },
      ),
      { numRuns: RUNS },
    );
    w.atLeast(60); // observed 119-134 runs with two or more tag slices
  });
});
