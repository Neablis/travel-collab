import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { renderMacro, type SpendByDayPayload } from "@tc/pages";
import type { ActivityTag, Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { SpendByDayBlock } from "./SpendByDayBlock";
import { tooltipFor } from "./SpendByDayChart";

// The chart's code is lazy. Loaded here so `findByRole`'s 1s wait is for React
// to draw it, not for a cold transform of Recharts — which alone is 550-650ms
// idle and ran out under full-suite load (`MacroView.test.tsx` has the numbers).
beforeAll(async () => {
  await import("./SpendByDayChart");
});

// What a reader takes from "Spend by day": the picture with ordinal days under
// it and NO number printed on it (Mitchell, PR 221 preview: *"Add the actual cost
// number here as a hover just so we dont have text issues wrapping into
// left/right lane"*), each day's numbers on hover, every number again in a
// table for a screen reader, and a line saying what the chart left out. The
// colours and fonts are `ui/chart.test.tsx`'s job.

function payloadOf(
  price: (trip: TripDetail, id: (day: number, slot: number) => string) => void,
  params: Record<string, unknown> = {},
): SpendByDayPayload {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 3, activitiesPerDay: 2 } });
  price(trip, (day, slot) => trip.days[day]!.activityIds[slot]!);
  const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "cost.chart", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-day") {
    throw new Error(`expected a spend-by-day block, got ${outcome.status}`);
  }
  return outcome.rendered.block;
}

const set = (trip: TripDetail, id: string, cost: Money, tags: ActivityTag[]) => {
  trip.activities[id] = { ...trip.activities[id]!, cost, tags };
};

describe("SpendByDayBlock", () => {
  // This used to assert each total printed over its bar. Those labels are gone,
  // so it asserts where the totals went instead: off the picture, and into the
  // table, whichever stack is on top of the day.
  it("prints no number on the picture, ticks days as ordinals, and keeps every total in the table", async () => {
    // Day 1 tops out on "untagged" and day 2 on "meal".
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 4000, currency: "USD" }, ["meal"]);
      set(trip, id(0, 1), { amountMinor: 1000, currency: "USD" }, []);
      set(trip, id(1, 0), { amountMinor: 2500, currency: "USD" }, ["meal"]);
    });
    render(<SpendByDayBlock payload={payload} />);

    // The picture is lazy: wait for the frame to stop being busy.
    const chart = await screen.findByRole("img", { name: payload.summary, busy: false });
    expect(within(chart).queryByText("$50.00")).toBeNull();
    expect(within(chart).queryByText("$25.00")).toBeNull();
    expect(["1st", "2nd", "3rd"].map((tick) => within(chart).getByText(tick).textContent)).toEqual(["1st", "2nd", "3rd"]);

    const rows = within(screen.getByRole("table", { name: "Spend by day" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[1]!.textContent)).toEqual(["$50.00", "$25.00", "nothing priced"]);
  });

  it("says the day's full name, its total and every stack on hover", () => {
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 4000, currency: "USD" }, ["meal"]);
      set(trip, id(0, 1), { amountMinor: 1000, currency: "USD" }, []);
    });
    const Hover = tooltipFor(payload);
    render(<Hover active payload={[{ payload: { index: 0 } }]} />);
    // "Day 1" in full, where the axis says "1st".
    expect(screen.getByText(/^Day 1( · .*)?$/)).toBeDefined();
    expect(screen.getByText("Total").nextSibling?.textContent).toBe("$50.00");
    expect(screen.getByText("Meal").nextSibling?.textContent).toBe("$40.00");
    expect(screen.getByText("Untagged").nextSibling?.textContent).toBe("$10.00");
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

  // The burn-down (Mitchell, PR 221 preview) keeps the table's promise: every
  // number the picture draws is in it, the running total and the budget left
  // included, and a missing budget is said rather than drawn at zero.
  it("burning down, carries the running total, the budget left and the pace in the table", () => {
    const payload = payloadOf(
      (trip, id) => {
        trip.budget = { amountMinor: 30000, currency: trip.currency };
        set(trip, id(0, 0), { amountMinor: 5000, currency: trip.currency }, ["meal"]);
        set(trip, id(1, 0), { amountMinor: 30000, currency: trip.currency }, ["lodging"]);
      },
      { view: "burndown" },
    );
    render(<SpendByDayBlock payload={payload} />);
    const table = screen.getByRole("table", { name: "Spend by day" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day", "Date", "Total", "By tag", "So far", "Budget left", "Even pace leaves",
    ]);
    const second = within(table).getAllByRole("row")[2]!;
    expect(within(second).getAllByRole("cell").slice(3).map((c) => c.textContent)).toEqual([
      "$350.00", "$50.00 over", "$100.00",
    ]);
    expect(screen.getByText("Even pace")).toBeDefined();
  });

  it("burning down with no budget, says so in words and draws no budget or pace", () => {
    const payload = payloadOf(
      (trip, id) => {
        trip.budget = null;
        set(trip, id(0, 0), { amountMinor: 5000, currency: trip.currency }, ["meal"]);
      },
      { view: "burndown" },
    );
    render(<SpendByDayBlock payload={payload} />);
    expect(screen.getByText("No budget set — this is spend so far.")).toBeDefined();
    expect(screen.queryByText("Even pace")).toBeNull();
    const table = screen.getByRole("table", { name: "Spend by day" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual([
      "Day", "Date", "Total", "By tag", "So far",
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
