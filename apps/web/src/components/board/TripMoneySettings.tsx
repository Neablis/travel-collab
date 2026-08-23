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
    // Redesign layout (Task 4.2, current/…dc.html:849-900): budget Input
    // first (1fr) then Currency select second (130px) — the reverse of this
    // component's old plain flex-column order. Dispatch logic below is
    // untouched, byte-identical to before this task.
    <div
      className="grid gap-2.5"
      // eslint-disable-next-line no-restricted-syntax -- the redesign's 1fr/130px budget-input split has no token equivalent, matching BudgetChip's computed-geometry pattern
      style={{ gridTemplateColumns: "1fr 130px" }}
    >
      <FormField
        id="trip-budget"
        label="Total for the trip"
        description="Used for the over-budget warning across lenses."
      >
        <div className="flex items-center gap-1.5">
          <MoneyInput
            id="trip-budget"
            value={budget}
            currency={currency}
            onChange={(money) => onCommand({ type: "SetTripBudget", tripId, budget: money })}
          />
          <Button variant="ghost" onClick={() => onCommand({ type: "SetTripBudget", tripId, budget: null })}>
            Clear budget
          </Button>
        </div>
      </FormField>
      <FormField id="trip-currency" label="Currency">
        <NativeSelect
          id="trip-currency"
          aria-label="Currency"
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
    </div>
  );
}
