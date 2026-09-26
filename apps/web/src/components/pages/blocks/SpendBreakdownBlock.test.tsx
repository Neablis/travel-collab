import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { renderMacro, type SpendBreakdownPayload, type SpendByDayPayload } from "@tc/pages";
import type { ActivityKind, ActivityTag, Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { SpendBreakdownBlock, breakdownChartConfig } from "./SpendBreakdownBlock";
import { spendChartConfig } from "./SpendByDayBlock";

// Loaded here so `findByRole`'s wait is for React to draw the picture, not for
// a cold transform of Recharts (`SpendByDayBlock.test.tsx` has the reason).
beforeAll(async () => {
  await import("./SpendBreakdownChart");
});

// What a reader takes from "Spend by kind" / "Spend by tag": the key, on
// screen, as a table named by the title — every slice by the board's word for
// it, its amount and its share, and the total — beside a picture named by the
// summary. The sums are the resolver's (`spendBreakdown.test.ts`); that every
// colour is a token is `ui/chart.test.tsx`'s.

function payloadOf(
  price: (trip: TripDetail, id: (day: number, slot: number) => string) => void,
  params: Record<string, unknown> = {},
): SpendBreakdownPayload {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2 } });
  trip.currency = "USD";
  price(trip, (day, slot) => trip.days[day]!.activityIds[slot]!);
  const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "cost.breakdown", params);
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-breakdown") {
    throw new Error(`expected a spend-breakdown block, got ${outcome.status}`);
  }
  return outcome.rendered.block;
}

const set = (trip: TripDetail, id: string, cost: Money | null, kind: ActivityKind, tags: ActivityTag[] = []) => {
  trip.activities[id] = { ...trip.activities[id]!, cost, kind, tags };
};

describe("SpendBreakdownBlock", () => {
  it("keys every kind by name with its amount and share, then the total", async () => {
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 30000, currency: "USD" }, "planned");
      set(trip, id(0, 1), { amountMinor: 5000, currency: "USD" }, "pending");
      set(trip, id(1, 0), { amountMinor: 15000, currency: "USD" }, "transit");
      set(trip, id(1, 1), null, "planned");
    });
    render(<SpendBreakdownBlock payload={payload} />);

    const rows = within(screen.getByRole("table", { name: "Spend by kind" })).getAllByRole("row").slice(1);
    expect(rows.map((row) => row.textContent)).toEqual([
      "Planned$300.0060%",
      "Pending$50.0010%",
      "Travel$150.0030%",
      "Total$500.00",
    ]);
    // The picture is lazy, and named by the sentence a screen reader hears.
    expect(await screen.findByRole("img", { name: payload.summary, busy: false })).toBeDefined();
  });

  it("keeps a kind nothing is priced on in the key, saying so, and names what it left off", () => {
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 30000, currency: "USD" }, "planned");
      set(trip, id(0, 1), { amountMinor: 1_200_000, currency: "JPY" }, "transit");
    });
    render(<SpendBreakdownBlock payload={payload} />);

    const travel = screen.getAllByRole("row").find((row) => within(row).queryByRole("rowheader", { name: "Travel" }))!;
    expect(within(travel).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["nothing priced", "—"]);
    expect(screen.getByText("Not charted: ¥12,000.00 in other currencies.")).toBeDefined();
  });

  it("keys every tag by name, untagged last, in a table named for what it is narrowed to", () => {
    const payload = payloadOf(
      (trip, id) => {
        set(trip, id(0, 0), { amountMinor: 30000, currency: "USD" }, "pending", ["meal", "outdoors"]);
        set(trip, id(0, 1), { amountMinor: 10000, currency: "USD" }, "pending");
        set(trip, id(1, 0), { amountMinor: 15000, currency: "USD" }, "planned", ["lodging"]);
      },
      { by: "tag", kind: "pending" },
    );
    render(<SpendBreakdownBlock payload={payload} />);

    const table = screen.getByRole("table", { name: "Spend by tag · Pending" });
    expect(within(table).getByRole("columnheader", { name: "Tag" })).toBeDefined();
    expect(within(table).getAllByRole("row").slice(1).map((row) => row.textContent)).toEqual([
      "Meal$300.0075%",
      "Lodgingnothing priced—",
      "Ticketednothing priced—",
      "Outdoorsnothing priced—",
      "Untagged$100.0025%",
      "Total$400.00",
    ]);
  });

  it("colours each tag's slice as Spend by day colours its stack", () => {
    const tags = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 100, currency: "USD" }, "planned", ["meal"]);
    }, { by: "tag" });
    const tagColors = breakdownChartConfig(tags);
    // The bars' own config for every stack, read from a payload that has them all.
    const bars: SpendByDayPayload = {
      kind: "spend-by-day", view: "bars", burnDown: null, days: [], budgetPerDay: null, ticks: [], summary: "", notCharted: null,
      series: tags.slices.map(({ key, label }) => ({ key: key as SpendByDayPayload["series"][number]["key"], label })),
    };
    const barColors = spendChartConfig(bars);
    expect(tags.slices).toHaveLength(5);
    for (const slice of tags.slices) expect(tagColors[slice.key]!.color, slice.key).toBe(barColors[slice.key]!.color);
  });
});
