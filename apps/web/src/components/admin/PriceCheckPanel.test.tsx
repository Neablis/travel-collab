import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AdminPriceCheckRow } from "@/lib/adminOverview";
import { PriceCheckPanel } from "./PriceCheckPanel";

// **The operator is who the price sweep reports to** (KI-2026-09-16-c), so the
// row that matters has to be on the screen, and "never asked" must not render
// as an empty — therefore clean — table.

afterEach(cleanup);

const row = (over: Partial<AdminPriceCheckRow> & { ref: string }): AdminPriceCheckRow => ({
  committed: { minor: 900, currency: "usd" },
  stripe: { id: "price_x", minor: 900, currency: "usd" },
  verdict: "ok",
  ...over,
});

describe("the price-check panel", () => {
  it("shows a mismatch with both numbers, beside an ordinary missing Price", () => {
    render(
      <PriceCheckPanel
        report={{
          status: "checked",
          rows: [
            row({ ref: "plus@v1", stripe: { id: "price_x", minor: 1, currency: "usd" }, verdict: "mismatch" }),
            row({ ref: "premium@v1", committed: { minor: 1900, currency: "usd" }, stripe: null, verdict: "missing" }),
          ],
        }}
      />,
    );
    const plus = screen.getByTestId("price-check-plus@v1");
    expect(plus.getAttribute("data-verdict")).toBe("mismatch");
    expect(plus.textContent).toContain("plan 900 usd");
    expect(plus.textContent).toContain("Stripe 1 usd");
    expect(plus.textContent).toContain("MISMATCH");
    expect(screen.getByTestId("price-check-premium@v1").textContent).toContain("no Price yet");
  });

  it("says it did not check, rather than showing an empty table", () => {
    render(<PriceCheckPanel report={{ status: "unavailable", reason: "stripe is down" }} />);
    expect(screen.getByTestId("price-check-unavailable").textContent).toContain("stripe is down");
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("says billing is off on a deployment with no keys", () => {
    render(<PriceCheckPanel report={{ status: "unconfigured" }} />);
    expect(screen.getByTestId("price-check-unconfigured")).toBeTruthy();
  });
});
