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
});
