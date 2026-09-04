import { describe, expect, it } from "vitest";
import { tripDetailFactory } from "@tc/factories";
import { renderMacro } from "../../registry";
import type { Seg, WidgetContext } from "../../registry-types";
import { selectionTrip } from "../../test-support/selectionTrip";
import { formatMoney } from "../../format";

const contextOf = ({ trip, globals }: ReturnType<typeof selectionTrip>): WidgetContext => ({
  trip,
  page: { tripId: trip.tripId },
  user: null,
  globals,
});

// The rendered rows, as text per row. Row CARDINALITY is the thing worth
// asserting about a repeater — CodeRabbit's finding on PR 139 was that checking
// "Day 1 and Day 2 both appear somewhere" passes for a renderer that puts both
// leads on one line — so these compare a list of lines, never a flattened blob.
function lines(ctx: WidgetContext, name: string, params: Record<string, unknown> = {}): string[] {
  const outcome = renderMacro(ctx, name, params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "rows") {
    throw new Error(`${name} did not render rows: ${outcome.status}`);
  }
  return outcome.rendered.rows.map((segs: Seg[]) => segs.map((s) => s.text).join(" ").trim());
}

describe("day.rows", () => {
  it("is a line per day, dated, placed and priced — what `day.line` drew", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    expect(lines(ctx, "day.rows")).toEqual([
      `Day 1 Jun 1, 2027 Rome ${formatMoney(fixture.trip.days[0]!.costSubtotal, "USD")}`,
      // Two city chips on the travel day, not one joined "Rome – Kyoto": each
      // wears the trip's own colour for that city, and one value can only wear
      // one.
      `Day 2 Jun 2, 2027 Rome Kyoto ${formatMoney(fixture.trip.days[1]!.costSubtotal, "USD")}`,
      // Day 3 has no date and no city; the line is shorter and still says which
      // day it is.
      `Day 3 ${formatMoney(fixture.trip.days[2]!.costSubtotal, "USD")}`,
    ]);
  });

  it("labels a line by its day of the trip, and drops the days a filter leaves out", () => {
    const ctx = contextOf(selectionTrip());
    expect(lines(ctx, "day.rows")).toHaveLength(3);
    const kyoto = lines(ctx, "day.rows", { city: "Kyoto" });
    // Only day 2 touches Kyoto, and it is still called Day 2.
    expect(kyoto).toHaveLength(1);
    expect(kyoto[0]).toContain("Day 2");
  });

  it("still renders a line without the globals projection, one value shorter", () => {
    // The honest degradation: a day with no city listed reads as a day whose
    // city we cannot name, and dropping the line because a projection is late
    // would lose the day itself.
    const { trip } = selectionTrip();
    const ctx: WidgetContext = { trip, page: { tripId: trip.tripId }, user: null, globals: null };
    const rows = lines(ctx, "day.rows");
    expect(rows).toHaveLength(3);
    expect(rows.join(" ")).not.toContain("Rome");
  });
});

describe("city.rows", () => {
  it("scopes a city's days AND its stop count to the selection", () => {
    // Same defect as `city.detail`'s, in the other shape: `entry.activityCount`
    // is the whole trip's, so a date-narrowed line showed one day beside a
    // count that included the days the filter had just excluded (CodeRabbit,
    // PR 141).
    const ctx = contextOf(selectionTrip());
    expect(lines(ctx, "city.rows", { dates: { from: "2027-06-01", through: "2027-06-01" } })).toEqual([
      "Rome Day 1 1 stop",
    ]);
  });

  it("counts a city's days from 1 and its stops by their own city — what `city.line` drew", () => {
    const ctx = contextOf(selectionTrip());
    expect(lines(ctx, "city.rows")).toEqual([
      "Rome Day 1, Day 2 2 stops",
      // Kyoto's second stop is the unscheduled one, which is on no day — which
      // is why a city's stop count is not its days' stop count.
      "Kyoto Day 2 2 stops",
    ]);
  });
});

describe("stop.rows", () => {
  it("is a line per booked stop on a day — what `booking.line` drew", () => {
    // ADR-039's fourth pair of widgets written twice: "booking" was already an
    // `ActivityKind` member, so `booking.line` is this primitive with
    // `kind: "booked"` and needed no new domain data at all.
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    const cost = formatMoney(fixture.trip.activities[fixture.ids.s0]!.cost!.amountMinor, "USD");
    expect(lines(ctx, "stop.rows", { day: { kind: "index", index: 0 }, kind: "booked" })).toEqual([
      `Colosseum 09:00 – 10:00 ${cost}`,
    ]);
  });

  it("is a line per stop on a day — what `stop.line` drew, tag and all", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    expect(lines(ctx, "stop.rows", { day: { kind: "index", index: 0 } }).map((r) => r.split(" ")[0])).toEqual([
      "Colosseum",
      "Lunch",
    ]);
    // A bound tag narrows to the stops carrying it, and a day whose stops all
    // lack it is `empty()` rather than the filter silently switching off.
    expect(lines(ctx, "stop.rows", { day: { kind: "index", index: 0 }, tag: "meal" }).map((r) => r.split(" ")[0])).toEqual([
      "Lunch",
    ]);
    expect(renderMacro(ctx, "stop.rows", { day: { kind: "index", index: 0 }, tag: "lodging" }).status).toBe("empty");
  });

  it("groups under day headers, and gives the backlog its own", () => {
    // A line with no heading over it reads as belonging to whatever came before
    // it, which for the unscheduled stops would be the last day of the trip.
    const ctx = contextOf(selectionTrip());
    const rows = lines(ctx, "stop.rows");
    // Seven stops and four headings, in order — the leads, not a flattened blob.
    expect(rows).toHaveLength(11);
    expect(rows.map((r) => r.split(" ")[0])).toEqual([
      "Day", "Colosseum", "Lunch",
      "Day", "Train", "Ryokan",
      "Day", "Free", "Maybe",
      "Unscheduled", "Souvenirs",
    ]);
    expect(rows.filter((r) => /^(Day \d|Unscheduled)$/.test(r))).toEqual(["Day 1", "Day 2", "Day 3", "Unscheduled"]);
  });

  it("uses no headings when the selection is one day", () => {
    const ctx = contextOf(selectionTrip());
    expect(lines(ctx, "stop.rows", { day: { kind: "index", index: 0 } })).toHaveLength(2);
  });
});

describe("cost.rows", () => {
  it("is a row per costed day, plus unscheduled, plus the total", () => {
    // **Every row, not the first and the last.** Checking only Day 1, the
    // unscheduled row and the total passes for a renderer that drops Day 2 and
    // Day 3 entirely (CodeRabbit, PR 141) — which is exactly what a breakdown
    // must not do.
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    const money = (index: number) => formatMoney(fixture.trip.days[index]!.costSubtotal, "USD");
    expect(lines(ctx, "cost.rows")).toEqual([
      `Day 1 · 2027-06-01 ${money(0)}`,
      `Day 2 · 2027-06-02 ${money(1)}`,
      // Day 3 has no date, so its label is the day number alone.
      `Day 3 ${money(2)}`,
      `Unscheduled ${formatMoney(fixture.trip.unscheduledCostSubtotal, "USD")}`,
      `Total ${formatMoney(fixture.trip.tripCostTotal, "USD")}`,
    ]);
  });

  it("re-sums the days when a content filter is set, since a subtotal cannot answer that", () => {
    const fixture = selectionTrip();
    const ctx = contextOf(fixture);
    const booked = lines(ctx, "cost.rows", { kind: "booked" });
    const s0 = fixture.trip.activities[fixture.ids.s0]!.cost!.amountMinor;
    const s3 = fixture.trip.activities[fixture.ids.s3]!.cost!.amountMinor;
    expect(booked).toEqual([
      `Day 1 · 2027-06-01 ${formatMoney(s0, "USD")}`,
      `Day 2 · 2027-06-02 ${formatMoney(s3, "USD")}`,
      `Total ${formatMoney(s0 + s3, "USD")}`,
    ]);
  });

  it("is empty when the selection costs nothing", () => {
    // Every stop in `selectionTrip` is costed — that is what makes its rollups
    // worth asserting against — so the zero case needs a trip with no prices on
    // it at all, which is the state a notebook opens in.
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 1, costed: false } });
    const ctx: WidgetContext = { trip, page: { tripId: trip.tripId }, user: null, globals: null };
    expect(renderMacro(ctx, "cost.rows", {}).status).toBe("empty");
  });
});
