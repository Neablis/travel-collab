"use client";

import { X } from "lucide-react";
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
      {/* `hint` (renders below the input), not `description` (renders
          between the label and the input) — the Currency field beside this
          one has no description, so a description here pushed this row's
          input down out of alignment with Currency's (Mitchell, reviewing
          the preview). Both fields' Label→input distance is now identical;
          the same helper copy just moves to below the input instead. */}
      <FormField id="trip-budget" label="Total for the trip" hint="Used for the over-budget warning across lenses.">
        <div className="relative">
          <MoneyInput
            id="trip-budget"
            value={budget}
            currency={currency}
            onChange={(money) => onCommand({ type: "SetTripBudget", tripId, budget: money })}
            className={budget !== null ? "pr-8" : undefined}
          />
          {/* Mitchell: "Put a X at the end of the budget input to clear, we
              dont need a clear budget button." Reuses TripDateControl's #19
              clear-X pattern (ghost icon Button, ARIA name "Clear <field>",
              only rendered when there's a value to clear) rather than a
              second clear-button style — just laid trailing-inside the input
              instead of beside it, since a budget figure and its clear-X
              read as one control the way the date's don't. */}
          {budget !== null && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Clear budget"
              className="absolute right-0.5 top-1/2 -translate-y-1/2"
              onClick={() => onCommand({ type: "SetTripBudget", tripId, budget: null })}
            >
              <X className="size-3.5" aria-hidden />
            </Button>
          )}
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
