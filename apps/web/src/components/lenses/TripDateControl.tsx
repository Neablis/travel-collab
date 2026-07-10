"use client";

import type { TripCommand } from "@tc/contracts";

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
  return (
    <span>
      <label>
        Start date{" "}
        <input
          type="date"
          value={startDate ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            onCommand({ type: "SetTripStartDate", tripId, startDate: value === "" ? null : value });
          }}
        />
      </label>{" "}
      <button
        type="button"
        onClick={() => onCommand({ type: "SetTripStartDate", tripId, startDate: null })}
      >
        Clear dates
      </button>
    </span>
  );
}
