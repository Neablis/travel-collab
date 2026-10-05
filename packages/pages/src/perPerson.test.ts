import { describe, expect, it } from "vitest";
import type { TripDetail } from "@tc/contracts";
import { tripDetailFactory, withCostRollups } from "@tc/factories";
import { renderMacro } from "./registry";
import type { WidgetContext } from "./registry-types";
import type { SpendBreakdownPayload, SpendByDayPayload } from "./chartPayloads";
import { formatMoney } from "./format";

// ADR-060: a stop's price is per person, and every cost widget multiplies it by
// who is in the stop — or by every member, when nobody is picked. Each widget
// below is asserted against a total worked out BY HAND from the fixture, never
// against `stopTotal`, so a widget that summed the raw price fails here even
// though it would still agree with itself.
//
// Three members. One day with two stops, and one unscheduled stop:
//
//   A  planned  $10.00 each  nobody picked  → × 3 = $30.00
//   B  pending  $7.00 each   u1, u2         → × 2 = $14.00  (an estimate)
//   C  planned  $5.00 each   u1, backlog    → × 1 =  $5.00
//
// Per person: day $44.00, trip $49.00, committed $35.00, estimated $14.00.
// Raw price: day $17.00, trip $22.00 — the numbers a regression would print.
function perPersonTrip(): TripDetail {
  const trip = tripDetailFactory.build(
    {},
    { transient: { dayCount: 1, activitiesPerDay: 2, unscheduledCount: 1, costed: true, currency: "USD" } },
  );
  const [a, b] = trip.days[0]!.activityIds as [string, string];
  const c = trip.backlog[0]!;
  const usd = (amountMinor: number) => ({ amountMinor, currency: "USD" });
  trip.members = [
    { userId: "u1", role: "owner" },
    { userId: "u2", role: "editor" },
    { userId: "u3", role: "viewer" },
  ];
  trip.activities[a] = { ...trip.activities[a]!, title: "A", kind: "planned", tags: [], cost: usd(10_00), participants: [] };
  trip.activities[b] = { ...trip.activities[b]!, title: "B", kind: "pending", tags: [], cost: usd(7_00), participants: ["u1", "u2"] };
  trip.activities[c] = { ...trip.activities[c]!, title: "C", kind: "planned", tags: [], cost: usd(5_00), participants: ["u1"] };
  return withCostRollups(trip);
}

const contextOf = (trip: TripDetail): WidgetContext => ({
  trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null,
});
const usd = (amountMinor: number) => formatMoney(amountMinor, "USD");

function rendered(name: string, params: Record<string, unknown> = {}, trip = perPersonTrip()) {
  const outcome = renderMacro(contextOf(trip), name, params);
  if (outcome.status !== "ok") throw new Error(`${name} said ${outcome.status}`);
  return outcome.rendered;
}

function block<K extends string>(name: string, kind: K, params: Record<string, unknown> = {}, trip = perPersonTrip()) {
  const r = rendered(name, params, trip);
  if (r.kind !== "block" || r.block.kind !== kind) throw new Error(`${name} did not render a ${kind}`);
  return r.block;
}

describe("a price is per person, in every cost widget (ADR-060)", () => {
  it("the fixture's own totals are per person — the board's numbers the widgets must match", () => {
    const trip = perPersonTrip();
    expect(trip.days[0]!.costSubtotal).toBe(44_00);
    expect(trip.unscheduledCostSubtotal).toBe(5_00);
    expect(trip.tripCostTotal).toBe(49_00);
  });

  it("`cost` splits the total into what is committed and what is a pending stop's estimate", () => {
    const text = (params: Record<string, unknown> = {}) => {
      const r = rendered("cost", params);
      if (r.kind !== "inline") throw new Error("cost is inline");
      return r.segs.map((seg) => seg.text).join("");
    };
    expect(text()).toBe(`${usd(35_00)} committed · ${usd(14_00)} estimated`);
    // Nothing pending, so nothing to split: one number, as before.
    expect(text({ kind: "planned" })).toBe(usd(35_00));
    // All of it pending: the whole of it is the estimate.
    expect(text({ kind: "pending" })).toBe(`${usd(14_00)} estimated`);
  });

  it("`cost.rows` totals each day, the backlog and the trip per person", () => {
    const r = rendered("cost.rows");
    if (r.kind !== "rows") throw new Error("cost.rows renders rows");
    const flat = r.rows.map((row) => [row.lead, ...row.cells].map((cell) => cell.map((seg) => seg.text).join("")).filter(Boolean).join(" "));
    expect(flat).toEqual(["Day 1 " + usd(44_00), "Unscheduled " + usd(5_00), "Total " + usd(49_00)]);
  });

  it("`cost.breakdown` slices and totals per person", () => {
    const pie = block("cost.breakdown", "spend-breakdown", { by: "kind" }) as SpendBreakdownPayload;
    expect(pie.total).toBe(usd(49_00));
    expect(Object.fromEntries(pie.slices.map((s) => [s.key, s.amount]))).toMatchObject({
      planned: usd(35_00),
      pending: usd(14_00),
    });
  });

  it("`cost.chart` draws the day per person and names the backlog per person", () => {
    const chart = block("cost.chart", "spend-by-day") as SpendByDayPayload;
    expect(chart.days[0]!.total).toBe(usd(44_00));
    expect(chart.notCharted).toContain(`${usd(5_00)} unscheduled`);
  });

  it("`day.detail`'s card totals the day per person, and each stop line stays its price for one", () => {
    const card = block("day.detail", "itinerary-day", { day: { kind: "index", index: 0 } });
    expect(card).toMatchObject({
      cost: usd(44_00),
      activities: [{ title: "A", cost: usd(10_00) }, { title: "B", cost: usd(7_00) }],
    });
  });

  // Travellers spec D1: u3 joined to advise. A, which nobody picked, is now
  // × 2 = $20.00, so: day $34.00, trip $39.00, committed $25.00. Counting every
  // member would print the $44 / $49 / $35 above.
  it("every cost widget prices a stop nobody picked for the travellers, not every member", () => {
    const base = perPersonTrip();
    const trip = withCostRollups({
      ...base,
      members: base.members.map((m) => (m.userId === "u3" ? { ...m, travelling: false } : m)),
    });
    expect([trip.days[0]!.costSubtotal, trip.tripCostTotal]).toEqual([34_00, 39_00]);

    const cost = rendered("cost", {}, trip);
    expect(cost.kind === "inline" && cost.segs.map((seg) => seg.text).join("")).toBe(`${usd(25_00)} committed · ${usd(14_00)} estimated`);
    const rows = rendered("cost.rows", {}, trip);
    expect(rows.kind === "rows" && rows.rows.map((row) => row.cells.flat().map((seg) => seg.text).join(""))).toEqual([
      usd(34_00), usd(5_00), usd(39_00),
    ]);
    const pie = block("cost.breakdown", "spend-breakdown", { by: "kind" }, trip) as SpendBreakdownPayload;
    expect([pie.total, pie.slices.find((s) => s.key === "planned")?.amount]).toEqual([usd(39_00), usd(25_00)]);
    expect((block("cost.chart", "spend-by-day", {}, trip) as SpendByDayPayload).days[0]!.total).toBe(usd(34_00));
    expect(block("day.detail", "itinerary-day", { day: { kind: "index", index: 0 } }, trip)).toMatchObject({ cost: usd(34_00) });
  });
});
