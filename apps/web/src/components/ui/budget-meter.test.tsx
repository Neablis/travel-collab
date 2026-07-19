import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetMeter } from "./budget-meter";

afterEach(cleanup);

it("shows spent-of-budget and stays brand under budget", () => {
  render(<BudgetMeter cost={5000} budget={10000} currency="USD" />);
  expect(screen.getByText(/50\.00 of 100\.00 USD/)).toBeTruthy();
  expect(screen.getByTestId("budget-meter-fill").className).toContain("bg-brand");
});

it("turns warning and clamps the fill when over budget", () => {
  render(<BudgetMeter cost={20000} budget={10000} currency="USD" />);
  expect(screen.getByTestId("budget-meter-fill").className).toContain("bg-warning");
});
