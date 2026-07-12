"use client";

import type { Money, TripCommand } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/ui/native-select";
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
    <div className="flex items-center gap-1.5">
      <FormField id="trip-currency" label="currency">
        <NativeSelect
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
        </NativeSelect>
      </FormField>
      <MoneyInput
        value={budget}
        currency={currency}
        onChange={(money) => onCommand({ type: "SetTripBudget", tripId, budget: money })}
      />
      <Button variant="ghost" onClick={() => onCommand({ type: "SetTripBudget", tripId, budget: null })}>
        Clear budget
      </Button>
    </div>
  );
}
