import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripMoneySettings } from "./TripMoneySettings";

afterEach(cleanup);

const TRIP = "7d9a1f8e-0000-4000-8000-00000000000a";

describe("TripMoneySettings", () => {
  it("emits SetTripCurrency on currency change and SetTripBudget on budget entry", async () => {
    const onCommand = vi.fn();
    render(<TripMoneySettings tripId={TRIP} currency="USD" budget={null} onCommand={onCommand} />);
    await userEvent.selectOptions(screen.getByLabelText(/currency/i), "EUR");
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripCurrency", tripId: TRIP, currency: "EUR" });
    // Task 4.2 relabeled the budget field "Total for the trip" — the label
    // no longer contains "budget", so the lookup needs a fresh match (still
    // resolving the same underlying MoneyInput; the assertion below is
    // unchanged).
    await userEvent.type(screen.getByLabelText(/cost|total for the trip/i), "2500");
    await userEvent.tab();
    expect(onCommand).toHaveBeenLastCalledWith({ type: "SetTripBudget", tripId: TRIP, budget: { amountMinor: 250000, currency: "USD" } });
  });

  // Mitchell: "Put a X at the end of the budget input to clear, we dont need
  // a clear budget button" — the standalone "Clear budget" Button is gone;
  // this is the #19 TripDateControl clear-X pattern reused, laid trailing
  // inside the input instead of beside it.
  it("clears the budget via the trailing X when a budget is set", async () => {
    const onCommand = vi.fn();
    render(
      <TripMoneySettings
        tripId={TRIP}
        currency="USD"
        budget={{ amountMinor: 250000, currency: "USD" }}
        onCommand={onCommand}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /clear budget/i }));
    expect(onCommand).toHaveBeenCalledWith({ type: "SetTripBudget", tripId: TRIP, budget: null });
  });

  it("hides the clear-X when there is no budget to clear", () => {
    render(<TripMoneySettings tripId={TRIP} currency="USD" budget={null} onCommand={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /clear budget/i })).toBeNull();
  });
});
