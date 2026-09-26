import { render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { renderMacro, type SpendByKindPayload } from "@tc/pages";
import type { ActivityKind, Money, TripDetail } from "@tc/contracts";
import { tripDetailFactory } from "@tc/factories";
import { SpendByKindBlock } from "./SpendByKindBlock";

// Loaded here so `findByRole`'s wait is for React to draw the picture, not for
// a cold transform of Recharts (`SpendByDayBlock.test.tsx` has the reason).
beforeAll(async () => {
  await import("./SpendByKindChart");
});

// What a reader takes from "Spend by kind": the key, on screen, as a table —
// every kind by the board's word for it, its amount and its share, and the
// total — beside a picture named by the summary. The sums are the resolver's
// (`spendByKind.test.ts`); the colours are `ui/chart.test.tsx`'s.

function payloadOf(price: (trip: TripDetail, id: (day: number, slot: number) => string) => void): SpendByKindPayload {
  const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 2 } });
  trip.currency = "USD";
  price(trip, (day, slot) => trip.days[day]!.activityIds[slot]!);
  const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "cost.byKind", {});
  if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-kind") {
    throw new Error(`expected a spend-by-kind block, got ${outcome.status}`);
  }
  return outcome.rendered.block;
}

const set = (trip: TripDetail, id: string, cost: Money | null, kind: ActivityKind) => {
  trip.activities[id] = { ...trip.activities[id]!, cost, kind };
};

describe("SpendByKindBlock", () => {
  it("keys every kind by name with its amount and share, then the total", async () => {
    const payload = payloadOf((trip, id) => {
      set(trip, id(0, 0), { amountMinor: 30000, currency: "USD" }, "planned");
      set(trip, id(0, 1), { amountMinor: 5000, currency: "USD" }, "pending");
      set(trip, id(1, 0), { amountMinor: 15000, currency: "USD" }, "transit");
      set(trip, id(1, 1), null, "planned");
    });
    render(<SpendByKindBlock payload={payload} />);

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
    render(<SpendByKindBlock payload={payload} />);

    const travel = screen.getAllByRole("row").find((row) => within(row).queryByRole("rowheader", { name: "Travel" }))!;
    expect(within(travel).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["nothing priced", "—"]);
    expect(screen.getByText("Not charted: ¥12,000.00 in other currencies.")).toBeDefined();
  });
});
