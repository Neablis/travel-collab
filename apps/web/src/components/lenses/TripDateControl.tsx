"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TripCommand } from "@tc/contracts";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Text } from "../ui/text";
import { DataText } from "../ui/data-text";
import { formatTripDateWithYear } from "../../lib/formatDate";

// Mitchell, 2026-08-23: "I do not want us picking an end date, it makes the
// UI awful. The end date will always be start date + number of days in trip
// = full trip." (SPEC.md §3.) So this control only ever picks the start; the
// end is display-only, derived by the caller from the plan's own last day
// (TripHeader.tsx) and passed in purely to render "→ Oct 16, 2026" beside
// the input. Nothing here grows or shrinks the day count — that's still
// legal at create time (SetTripDates, the wizard's length chips) and for
// the AI's planning tool, just not through this control.
export function TripDateControl({
  tripId,
  startDate,
  endDate = null,
  dayCount = 0,
  onCommand,
}: {
  tripId: string;
  startDate: string | null;
  endDate?: string | null;
  dayCount?: number;
  onCommand: (command: TripCommand) => void;
}) {
  const [pendingStart, setPendingStart] = useState(startDate ?? "");

  // The Settings sheet this control lives in doesn't unmount on every prop
  // change, only on close/reopen — so the local staging state above is only
  // seeded once by useState's initializer. Without this, a collaborator's
  // concurrent SetTripStartDate landing via useTrip() while the sheet stays
  // open would be silently invisible here, and a later "Done" click would
  // stomp their update with this user's stale value. Prop changes always win
  // over unsaved local edits: an in-progress edit getting overwritten by
  // fresher server data is far better than the reverse (submitting stale
  // data over a collaborator's newer change).
  useEffect(() => {
    setPendingStart(startDate ?? "");
  }, [startDate]);

  const commit = () => {
    onCommand({ type: "SetTripStartDate", tripId, startDate: pendingStart === "" ? null : pendingStart });
  };

  return (
    <div className="flex flex-col gap-2">
      {/* One row (design …dc.html:1122): the input, the derived end as plain
          mono text, then a ghost Done. flex-wrap is a safety net, not the
          intended layout — same popover-width reasoning the old two-field
          layout carried, now with far less to fit. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          type="date"
          aria-label="Trip start date"
          value={pendingStart}
          onChange={(e) => setPendingStart(e.target.value)}
          className="w-auto"
        />
        {endDate !== null && <DataText size="sm">{`→ ${formatTripDateWithYear(endDate)}`}</DataText>}
        <Button type="button" variant="ghost" size="sm" onClick={commit}>
          Done
        </Button>
        {/* #19: clearing is a rare, single-action op — a direct X next to the
            date, not a menu. Only shown when there's a date to clear. It
            clears the start date alone, day count untouched. */}
        {startDate !== null && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Clear date"
            onClick={() => {
              setPendingStart("");
              onCommand({ type: "SetTripStartDate", tripId, startDate: null });
            }}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        )}
      </div>
      <Text variant="muted">
        {`Pick the day you leave. The end follows the ${dayCount} days in your plan — add or remove a day and it moves.`}
      </Text>
    </div>
  );
}
