import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminRevenueView } from "@/lib/adminOverview";
import { RevenueStaleBanner } from "./RevenueStrip";

// **`webhooks-behind` is a page-level banner on Financial and Users** (M36
// link 1). It is the only thing that tells an operator MRR is a floor, so it
// must appear for one unpriceable subscription and must not cry wolf at zero.

afterEach(cleanup);

const revenue = (unpricedSubscriptions: number): AdminRevenueView => ({
  mrrMicroUsd: 0,
  addedMicroUsd: 0,
  lostMicroUsd: 0,
  arpuAllMicroUsd: 0,
  arpuPayingMicroUsd: 0,
  accounts: 0,
  payingAccounts: 0,
  medianMarginMicroUsd: null,
  unpricedSubscriptions,
  payersWithUnknownCost: 0,
  windowDays: 30,
});

describe("the stale-revenue banner", () => {
  it("names one unpriceable subscription in the singular", () => {
    render(<RevenueStaleBanner revenue={revenue(1)} />);
    expect(screen.getByTestId("revenue-unpriced").textContent).toContain(
      "1 subscription pins a plan version this deploy cannot price",
    );
  });

  it("names several in the plural", () => {
    render(<RevenueStaleBanner revenue={revenue(3)} />);
    expect(screen.getByTestId("revenue-unpriced").textContent).toContain(
      "3 subscriptions pin a plan version this deploy cannot price",
    );
  });

  it("renders nothing when every subscription is priced", () => {
    const { container } = render(<RevenueStaleBanner revenue={revenue(0)} />);
    expect(container.innerHTML).toBe("");
  });
});
