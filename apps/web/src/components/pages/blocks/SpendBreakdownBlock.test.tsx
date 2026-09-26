import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { KIND_LABEL, TAG_LABEL, renderMacro, type SpendBreakdownPayload, type SpendByDayPayload } from "@tc/pages";
import { ActivityKind, ActivityTag, type Money, type TripDetail } from "@tc/contracts";
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
  stops = 4,
): SpendBreakdownPayload {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: Math.ceil(stops / 2) } });
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

  it("never keys shares that add up past 100%, nor calls a real cost 0%", () => {
    // 16.5% / 16.5% / 67% rounds to 17 + 17 + 67 = 101 slice by slice; and a
    // sliver beside a large cost rounds to 0. The key a reader adds up says
    // 100 in both, and the sliver still says it is there.
    const shownShares = () =>
      within(screen.getByRole("table", { name: "Spend by kind" }))
        .getAllByRole("row")
        .slice(1, -1)
        .map((row) => within(row).getAllByRole("cell")[1]!.textContent);
    const percentsOf = (shares: (string | null)[]) =>
      shares.filter((share) => share !== "—").map((share) => (share === "<1%" ? 0 : Number.parseInt(share!, 10)));

    const halves = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 67000, currency: "USD" }, "planned");
      set(trip, id(0, 1), { amountMinor: 16500, currency: "USD" }, "pending");
      set(trip, id(1, 0), { amountMinor: 16500, currency: "USD" }, "transit");
    });
    const { unmount } = render(<SpendBreakdownBlock payload={halves} />);
    expect(shownShares()).toEqual(["67%", "17%", "16%"]);
    expect(percentsOf(shownShares()).reduce((a, b) => a + b, 0)).toBe(100);
    unmount();

    const sliver = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 1_000_000, currency: "USD" }, "planned");
      set(trip, id(0, 1), { amountMinor: 100, currency: "USD" }, "transit");
    });
    render(<SpendBreakdownBlock payload={sliver} />);
    expect(shownShares()).toEqual(["100%", "—", "<1%"]);
    expect(percentsOf(shownShares()).reduce((a, b) => a + b, 0)).toBe(100);
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

  it("gives every kind and every tag the contract defines a slice, its label from the map, a colour and a title", () => {
    // Mitchell, 2026-09-26: *"Use what the typescript define … and should
    // change if we add more in future"*. Swept over the enums themselves, so a
    // sixth tag or a fourth kind is checked the day it exists: one priced stop
    // per value, so every slice has money and a colour to draw it in.
    const everyValue = (params: Record<string, unknown>) =>
      payloadOf((trip) => {
        const ids = trip.days.flatMap((day) => day.activityIds);
        ActivityKind.options.forEach((kind, i) => set(trip, ids[i]!, { amountMinor: 100, currency: "USD" }, kind));
        ActivityTag.options.forEach((tag, i) =>
          set(trip, ids[ActivityKind.options.length + i]!, { amountMinor: 100, currency: "USD" }, "planned", [tag]),
        );
      }, params, ActivityKind.options.length + ActivityTag.options.length);

    const byKind = everyValue({});
    expect(byKind.slices.map((s) => [s.key, s.label])).toEqual(ActivityKind.options.map((k) => [k, KIND_LABEL[k]]));
    const byTag = everyValue({ by: "tag" });
    expect(byTag.slices.map((s) => s.key)).toEqual([...ActivityTag.options, "untagged"]);
    for (const tag of ActivityTag.options) expect(byTag.slices.find((s) => s.key === tag)!.label).toBe(TAG_LABEL[tag]);

    for (const payload of [byKind, byTag]) {
      const config = breakdownChartConfig(payload);
      for (const slice of payload.slices) {
        expect(slice.amountMinor, `${slice.key} has money`).toBeGreaterThan(0);
        expect(config[slice.key]?.color, `${slice.key} has a colour`).toMatch(/^--color-/);
        expect(config[slice.key]?.label).toBe(slice.label);
      }
    }
    // The title names a narrowing in the same words.
    for (const kind of ActivityKind.options) {
      expect(everyValue({ by: "tag", kind }).title).toBe(`Spend by tag · ${KIND_LABEL[kind]}`);
    }
    for (const tag of ActivityTag.options) {
      expect(everyValue({ tag }).title).toBe(`Spend by kind · ${TAG_LABEL[tag]}`);
    }
  });
});
