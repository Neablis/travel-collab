"use client";

import type { TripCommand } from "@tc/contracts";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { Button } from "../ui/button";

// This is where "drag the vacation" lives: shifting the trip's start date
// re-derives every day's date downstream. Drag-to-shift on the calendar grid
// is later polish; a date input satisfies the gate today.
export function TripDateControl({
  tripId,
  startDate,
  onCommand,
}: {
  tripId: string;
  startDate: string | null;
  onCommand: (command: TripCommand) => void;
}) {
  const inputId = `trip-start-date-${tripId}`;

  return (
    <span className="flex items-end gap-2">
      <FormField id={inputId} label="Start date">
        <Input
          id={inputId}
          type="date"
          value={startDate ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            onCommand({ type: "SetTripStartDate", tripId, startDate: value === "" ? null : value });
          }}
        />
      </FormField>
      <Button type="button" onClick={() => onCommand({ type: "SetTripStartDate", tripId, startDate: null })}>
        Clear dates
      </Button>
    </span>
  );
}
