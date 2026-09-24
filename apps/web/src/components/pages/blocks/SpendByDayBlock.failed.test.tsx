import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderMacro } from "@tc/pages";
import { tripDetailFactory } from "@tc/factories";
import { SpendByDayBlock } from "./SpendByDayBlock";

// A chart whose code never arrives (a deploy replaced the chunk, the network
// dropped): `Suspense` does not catch a rejected `lazy` import, so without a
// boundary of its own the block would throw to the route's error screen and
// take the page with it. A file of its own for `SpendByDayBlock.lazy.test.tsx`'s
// reason: `lazy` resolves once per module.
vi.mock("./SpendByDayChart", () => Promise.reject(new Error("Failed to fetch dynamically imported module")));

afterEach(() => vi.restoreAllMocks());

describe("SpendByDayBlock when its chart fails to load", () => {
  it("keeps the failure inside the chart's frame: same height, no longer busy, key and table still there", async () => {
    // React logs the caught error; it is the expected one, not noise to hide.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
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
    const failed = await screen.findByRole("img", { name: payload.summary, busy: false });
    expect(failed.style.height).toBe(loading.style.height);
    expect(screen.getByRole("table", { name: "Spend by day" })).toBeDefined();
    expect(logged).toHaveBeenCalled();
  });
});
