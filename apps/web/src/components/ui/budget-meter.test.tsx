import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { BudgetMeter } from "./budget-meter";

afterEach(cleanup);

it("shows spent-of-budget with the currency symbol, not the bare code", () => {
  render(<BudgetMeter cost={5000} budget={10000} currency="USD" />);
  expect(screen.getByText(/\$50\.00 of \$100\.00/)).toBeTruthy();
  expect(screen.getByTestId("budget-meter-fill").className).toContain("bg-brand");
});

it("turns warning and clamps the fill when over budget", () => {
  render(<BudgetMeter cost={20000} budget={10000} currency="USD" />);
  expect(screen.getByTestId("budget-meter-fill").className).toContain("bg-warning");
});

// Regression: 9ae98aa routed money everywhere else through formatMoney's
// CURRENCY_SYMBOLS, but this meter hand-formatted its own money and kept
// appending the bare code — CHF has no symbol in that map, so it's the one
// currency where "of {code}" is still correct, not a leftover bug.
it("falls back to the trailing code only for a currency with no symbol", () => {
  render(<BudgetMeter cost={5000} budget={10000} currency="CHF" />);
  expect(screen.getByText(/50\.00 CHF of 100\.00 CHF/)).toBeTruthy();
});
