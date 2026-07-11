"use client";

import type { Money, TripCommand } from "@tc/contracts";
import { MoneyInput } from "./MoneyInput";

const CURRENCIES = ["USD", "EUR", "GBP", "JPY", "CAD", "AUD", "CHF"] as const;

export function TripMoneySettings({
  tripId,
  currency,
  budget,
  onCommand,
}: {
  tripId: string;
  currency: string;
  budget: Money | null;
  onCommand: (command: TripCommand) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <label htmlFor="trip-currency">currency</label>
      <select
        id="trip-currency"
        aria-label="currency"
        value={currency}
        onChange={(e) => onCommand({ type: "SetTripCurrency", tripId, currency: e.target.value })}
      >
        {CURRENCIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
      <MoneyInput
        value={budget}
        currency={currency}
        onChange={(money) => onCommand({ type: "SetTripBudget", tripId, budget: money })}
      />
      <button type="button" onClick={() => onCommand({ type: "SetTripBudget", tripId, budget: null })}>
        Clear budget
      </button>
    </div>
  );
}
