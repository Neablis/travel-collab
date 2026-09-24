import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderMacro } from "@tc/pages";
import { tripDetailFactory } from "@tc/factories";
import { SpendByDayBlock } from "./SpendByDayBlock";

// ADR-044 across the lazy load: the chart's code (Recharts) arrives after the
// block, and the block must not change height when it does.
//
// A file of its own because `React.lazy` resolves once per module: in a file
// where an earlier test already drew a chart, this one would never see the
// loading state. The gate holds the chart module back until the test opens it,
// so "before" is observed rather than assumed.
const gate = vi.hoisted(() => {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open: () => open() };
});
vi.mock("./SpendByDayChart", async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});

describe("SpendByDayBlock while its chart loads", () => {
  it("holds the chart's height and name, and shows the key and table already", async () => {
    const trip = tripDetailFactory.build({}, { transient: { dayCount: 2, activitiesPerDay: 1 } });
    const id = trip.days[0]!.activityIds[0]!;
    trip.activities[id] = { ...trip.activities[id]!, cost: { amountMinor: 4000, currency: "USD" }, tags: [] };
    const outcome = renderMacro({ trip, page: { tripId: trip.tripId }, user: null, globals: null, today: null }, "cost.chart", {});
    if (outcome.status !== "ok" || outcome.rendered.kind !== "block" || outcome.rendered.block.kind !== "spend-by-day") {
      throw new Error(`expected a spend-by-day block, got ${outcome.status}`);
    }
    const payload = outcome.rendered.block;
    render(<SpendByDayBlock payload={payload} />);

    const loading = screen.getByRole("img", { name: payload.summary, busy: true });
    expect(loading.style.height).not.toBe("");
    expect(screen.getByRole("table", { name: "Spend by day" })).toBeDefined();

    await act(async () => gate.open());
    const drawn = await screen.findByRole("img", { name: payload.summary, busy: false });
    expect(drawn.style.height).toBe(loading.style.height);
    expect(screen.queryByRole("img", { busy: true })).toBeNull();
  });
});
