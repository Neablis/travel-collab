import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PlanId } from "@tc/contracts";
import type { AdminTierSeriesRow } from "@/lib/adminOverview";
import { TierGrowthCharts } from "./TierGrowthCharts";

// What the Users tab draws from `tier_weekly`. The counts themselves are held
// against Postgres in `tierRollup.int.test.ts`; this is the card's arithmetic
// and wording: a NET change over the last four weeks, said to be net, and the
// first week the history starts from.

afterEach(cleanup);

const WEEKS = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12"];

const tier = (planId: PlanId, counts: readonly number[]): AdminTierSeriesRow => ({
  planId,
  points: counts.map((accounts, i) => ({ weekStart: WEEKS[i]!, accounts })),
});

describe("TierGrowthCharts", () => {
  it("says the net change from four weeks before the newest week, and that it is net", () => {
    // Up 10 over the whole series, but from 2026-09-14 (four weeks back) to now
    // it is 15 → 12: down 3.
    render(<TierGrowthCharts tiers={[tier("plus", [2, 15, 20, 9, 14, 12])]} />);
    expect(screen.getByTestId("tier-growth-plus-net").textContent).toBe("−3 net, last 4 weeks");
    expect(screen.getByTestId("tier-growth-plus-now").textContent).toBe("12");
  });

  it("measures from the first week while there are fewer than four", () => {
    render(<TierGrowthCharts tiers={[tier("premium", [3, 4, 6])]} />);
    expect(screen.getByTestId("tier-growth-premium-net").textContent).toBe("+3 net, last 2 weeks");
    expect(screen.getByTestId("tier-growth-premium-since").textContent).toBe("since 7 Sep");
  });

  it("draws one card per tier, top tier first", () => {
    render(<TierGrowthCharts tiers={[tier("free", [40]), tier("plus", [7]), tier("premium", [2])]} />);
    expect(screen.getAllByRole("region").map((card) => card.getAttribute("aria-label"))).toEqual([
      "premium accounts by week",
      "plus accounts by week",
      "free accounts by week",
    ]);
  });

  it("says nothing has been counted before the first rollup", () => {
    render(<TierGrowthCharts tiers={[tier("free", []), tier("plus", [])]} />);
    expect(screen.getByRole("heading", { name: "No weekly counts yet" })).toBeTruthy();
    expect(screen.queryByRole("region")).toBeNull();
  });
});
