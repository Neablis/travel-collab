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
    await userEvent.type(screen.getByLabelText(/cost|budget/i), "2500");
    expect(onCommand).toHaveBeenLastCalledWith({ type: "SetTripBudget", tripId: TRIP, budget: { amountMinor: 250000, currency: "USD" } });
  });
});
