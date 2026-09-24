import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { renderMacro, type SpendByDayPayload } from "@tc/pages";
import type { ActivityTag, Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { SpendByDayBlock } from "./SpendByDayBlock";

// What a reader takes from "Spend by day" without hovering anything: each
// day's total printed over its bar, the numbers again in a table for a screen
// reader, and a line saying what the chart left out. The colours and fonts are
// `ui/chart.test.tsx`'s job.

function payloadOf(price: (trip: TripDetail, id: (day: number, slot: number) => string) => void): SpendByDayPayload {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 3, activitiesPerDay: 2 } });
  price(trip, (day, slot) => trip.days[day]!.activityIds[slot]!);
  const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "cost.chart", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-day") {
    throw new Error(`expected a spend-by-day block, got ${outcome.status}`);
  }
  return outcome.rendered.block;
}

const set = (trip: TripDetail, id: string, cost: Money, tags: ActivityTag[]) => {
  trip.activities[id] = { ...trip.activities[id]!, cost, tags };
};

describe("SpendByDayBlock", () => {
  it("prints every priced day's total over its bar, whichever stack is on top", async () => {
    // Day 1 tops out on "untagged" and day 2 on "meal": a total that rode on
    // the last series alone would vanish from day 2.
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 4000, currency: "USD" }, ["meal"]);
      set(trip, id(0, 1), { amountMinor: 1000, currency: "USD" }, []);
      set(trip, id(1, 0), { amountMinor: 2500, currency: "USD" }, ["meal"]);
    });
    render(<SpendByDayBlock payload={payload} />);

    // The picture is lazy: wait for the frame to stop being busy.
    const chart = await screen.findByRole("img", { name: payload.summary, busy: false });
    expect(within(chart).getByText("$50.00")).toBeDefined();
    expect(within(chart).getByText("$25.00")).toBeDefined();
  });

  it("gives a screen reader the numbers as a table, a day per row", () => {
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 4000, currency: "USD" }, ["meal"]);
      set(trip, id(0, 1), { amountMinor: 20000, currency: "USD" }, ["lodging"]);
    });
    render(<SpendByDayBlock payload={payload} />);

    const rows = within(screen.getByRole("table", { name: "Spend by day" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))).toEqual([
      [expect.any(String), "$240.00", "Meal $40.00, Lodging $200.00"],
      [expect.any(String), "nothing priced", "—"],
      [expect.any(String), "nothing priced", "—"],
    ]);
  });

  it("says what it left off the chart", () => {
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 4000, currency: "USD" }, []);
      set(trip, id(1, 0), { amountMinor: 1200000, currency: "JPY" }, []);
    });
    render(<SpendByDayBlock payload={payload} />);
    expect(screen.getByText("Not charted: ¥12,000.00 in other currencies.")).toBeDefined();
  });
});
