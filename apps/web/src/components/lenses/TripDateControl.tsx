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
// Mirrors the contracts package's own SetTripStartDate.startDate regex
// (trip.ts) — not imported from there because it isn't exported, and this
// is a UI dispatch guard, not a re-declaration of the command's shape.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function TripDateControl({
  tripId,
  startDate,
  endDate = null,
  dayCount = 0,
  onCommand,
  onClose,
}: {
  tripId: string;
  startDate: string | null;
  endDate?: string | null;
  dayCount?: number;
  onCommand: (command: TripCommand) => void;
  // Feedback from Mitchell testing the preview, 2026-08-24: selecting a date
  // now saves immediately (see handleChange below), so Done no longer has a
  // command to send. It still needs to close the popover this control lives
  // in (SettingsSheet.tsx) — that open/closed state is the parent's, not
  // this control's, so it's handed down rather than dispatched as a command.
  onClose?: () => void;
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

  // Selecting a date commits it immediately (Mitchell, testing the preview:
  // "Selecting the date with the date picker should automatically save, you
  // shouldnt have to hit done.") — but a native type="date" input's `change`
  // fires on partial states too in some browsers (typing into a segment,
  // clearing one), and its `value` is only guaranteed complete-or-empty by
  // spec, not by every implementation. Two guards, both required:
  //   1. Never dispatch on "" — that's the dedicated Clear-date X's job.
  //   2. Never dispatch a value that isn't a full YYYY-MM-DD, so a half-typed
  //      segment can't reach SetTripStartDate.
  // A third guard is just hygiene, not safety: skip dispatch entirely if the
  // value already matches the server's startDate, so re-selecting the same
  // date doesn't add a redundant no-op entry to trip history/undo.
  const handleChange = (value: string) => {
    setPendingStart(value);
    if (!ISO_DATE_RE.test(value)) return;
    if (value === (startDate ?? "")) return;
    onCommand({ type: "SetTripStartDate", tripId, startDate: value });
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
          onChange={(e) => handleChange(e.target.value)}
          className="w-auto"
        />
        {endDate !== null && <DataText size="sm">{`→ ${formatTripDateWithYear(endDate)}`}</DataText>}
        {/* Close-only now (see onClose above) — saving happens on selection,
            not here. Kept rather than deleted: the design
            (…dc.html:1122-1138) has a ghost Done in this edit state, and the
            control still needs an explicit way back to its read state
            beyond relying on the popover's own outside-click/Escape dismiss. */}
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
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
