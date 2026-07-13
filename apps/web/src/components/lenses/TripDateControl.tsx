"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import type { TripCommand } from "@tc/contracts";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Popover } from "../ui/popover";

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
  const [menuOpen, setMenuOpen] = useState(false);

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
      {/* Clearing the date is a rare operation, so it's tucked behind a
          small Popover trigger rather than sitting as a standalone,
          always-visible button (#2, PR #11 feedback). */}
      <Popover
        open={menuOpen}
        onOpenChange={setMenuOpen}
        align="end"
        trigger={
          <Button variant="ghost" size="icon" aria-label="Date options">
            <Settings className="size-3.5" aria-hidden />
          </Button>
        }
      >
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onCommand({ type: "SetTripStartDate", tripId, startDate: null });
            setMenuOpen(false);
          }}
        >
          Clear date
        </Button>
      </Popover>
    </span>
  );
}
