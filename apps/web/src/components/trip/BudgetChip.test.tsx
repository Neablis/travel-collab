import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetChip } from "./BudgetChip";

afterEach(cleanup);

// Money renders with the app's one shared formatter (formatMoney.ts, KI-2):
// grouped 2-decimal amount + currency-code suffix ("9,085.00 USD"), not a
// currency-symbol prefix — every other money display in the app (BudgetMeter,
// the lenses) uses this same convention, and a second one here would reopen
// the "money formatted two ways in the same screen" bug KI-2 already closed.
describe("BudgetChip", () => {
  it("shows the planned total, the budget and the remaining badge", () => {
    render(
      <BudgetChip
        spend={{ total: 908_500, unpriced: 0, budget: 1_640_000, remaining: 731_500, over: false }}
        currency="USD"
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText("9,085.00 USD")).toBeTruthy();
    expect(screen.getByText("of 16,400.00 USD")).toBeTruthy();
    expect(screen.getByText("7,315.00 USD left")).toBeTruthy();
  });

  it("reads as over budget with a warning badge", () => {
    render(
      <BudgetChip
        spend={{ total: 1_722_000, unpriced: 0, budget: 1_640_000, remaining: -82_000, over: true }}
        currency="USD"
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText("820.00 USD over")).toBeTruthy();
  });

  it("invites setting a budget when there is none", () => {
    render(
      <BudgetChip
        spend={{ total: 0, unpriced: 0, budget: null, remaining: null, over: false }}
        currency="USD"
        onOpenSettings={() => {}}
      />,
    );

    expect(screen.getByText("Set a budget")).toBeTruthy();
  });

  it("opens settings when clicked", async () => {
    const onOpenSettings = vi.fn();
    render(
      <BudgetChip
        spend={{ total: 908_500, unpriced: 0, budget: 1_640_000, remaining: 731_500, over: false }}
        currency="USD"
        onOpenSettings={onOpenSettings}
      />,
    );

    await userEvent.click(screen.getByRole("button"));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });
});
