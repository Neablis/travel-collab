"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { TripCommand } from "@tc/contracts";
import { FormField } from "../ui/form-field";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { Dialog, DialogFooter } from "../ui/dialog";
import { daySpan } from "../../lib/dates";

// A small surplus over the exact "needed" count, so an off-by-one in the
// daySpan/dayCount math on this side never trips the server's
// not-enough-day-ids rejection (packages/domain/src/trip/decide.ts) — spare
// ids are cheap to mint and cost nothing if the reconcile doesn't use them.
const ID_SURPLUS = 2;

// This is where "drag the vacation" lives: editing the trip's date range
// re-derives every day's date downstream, and growing/shrinking the range
// reconciles the day COUNT to match (decide.ts's SetTripDates handling).
// Drag-to-shift on the calendar grid is later polish; two date inputs plus
// an explicit "Set dates" commit satisfies the gate today.
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
  const startInputId = `trip-start-date-${tripId}`;
  const endInputId = `trip-end-date-${tripId}`;

  // Both fields are locally staged and only committed on "Set dates" — a
  // single onChange-per-keystroke dispatch (the old start-date-only
  // behavior) can't work once committing needs to look at BOTH fields
  // together to decide whether the range grew, shrank, or needs a confirm.
  const [pendingStart, setPendingStart] = useState(startDate ?? "");
  const [pendingEnd, setPendingEnd] = useState(endDate ?? "");
  const [confirmDrop, setConfirmDrop] = useState<number | null>(null);

  // The Settings sheet this control lives in doesn't unmount on every prop
  // change, only on close/reopen — so the local staging state above is only
  // seeded once by useState's initializer. Without this, a collaborator's
  // concurrent SetTripDates landing via useTrip() while the sheet stays open
  // would be silently invisible here, and a later "Set dates" click would
  // stomp their update with this user's stale values. Prop changes always
  // win over unsaved local edits: an in-progress edit getting overwritten by
  // fresher server data is far better than the reverse (submitting stale
  // data over a collaborator's newer change). Any in-flight shrink
  // confirmation is cancelled too, since its "drops N days" count was
  // computed from the now-stale pending values and would otherwise mislead.
  useEffect(() => {
    setPendingStart(startDate ?? "");
    setPendingEnd(endDate ?? "");
    setConfirmDrop(null);
  }, [startDate, endDate]);

  const dispatchSetDates = (nextStart: string | null, nextEnd: string | null) => {
    let newDayIds: string[] = [];
    if (nextStart !== null && nextEnd !== null) {
      const needed = Math.max(0, daySpan(nextStart, nextEnd) - dayCount);
      if (needed > 0) {
        newDayIds = Array.from({ length: needed + ID_SURPLUS }, () => crypto.randomUUID());
      }
    }
    onCommand({ type: "SetTripDates", tripId, startDate: nextStart, endDate: nextEnd, newDayIds });
  };

  const commit = () => {
    const nextStart = pendingStart === "" ? null : pendingStart;
    const nextEnd = pendingEnd === "" ? null : pendingEnd;

    if (nextStart !== null && nextEnd !== null) {
      const span = daySpan(nextStart, nextEnd);
      if (span < dayCount) {
        // Shrinking loses days from the tail (decide.ts) — their activities
        // move to the backlog rather than being deleted, but that's still
        // worth a confirm before committing.
        setConfirmDrop(dayCount - span);
        return;
      }
    }
    dispatchSetDates(nextStart, nextEnd);
  };

  const confirmShrink = () => {
    const nextStart = pendingStart === "" ? null : pendingStart;
    const nextEnd = pendingEnd === "" ? null : pendingEnd;
    dispatchSetDates(nextStart, nextEnd);
    setConfirmDrop(null);
  };

  return (
    <>
      {/* Two explicit rows (fields, then actions) rather than one row relying
          on flex-wrap to reflow "in the right place": this control now mounts
          inside the Dates row's Popover (SettingsSheet.tsx), a fixed w-80 box
          with ~296px of usable width after padding — nowhere near the ~410px
          a single non-wrapping row of both date fields + both buttons needs.
          A stacked layout fits deterministically regardless of container
          width. flex-wrap stays on the fields row itself as a safety net:
          native <input type="date"> rendered width varies by browser/OS/font,
          and 153+153+gap is already close to the popover's usable width, so
          End date should drop to its own line rather than spill past the
          popover/viewport edge if it ever doesn't fit beside Start date. */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-1">
          <FormField id={startInputId} label="Start date">
            <Input
              id={startInputId}
              type="date"
              value={pendingStart}
              onChange={(e) => setPendingStart(e.target.value)}
            />
          </FormField>
          <FormField id={endInputId} label="End date">
            <Input id={endInputId} type="date" value={pendingEnd} onChange={(e) => setPendingEnd(e.target.value)} />
          </FormField>
        </div>
        <div className="flex items-center gap-1">
          <Button type="button" onClick={commit}>
            Set dates
          </Button>
          {/* Clearing is a rare op with a single action, so it's a direct X next to
              the date rather than a one-item "Date options" popover (#19) — only
              shown when there's a date to clear. It clears the start date alone
              (mirrors the original SetTripStartDate behavior) without touching
              the end date/day count. */}
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
      </div>
      {confirmDrop !== null && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirmDrop(null);
          }}
          title="Shrink the trip dates?"
        >
          <p>
            This range drops {confirmDrop} day{confirmDrop === 1 ? "" : "s"} from the end of the trip. Their
            activities move to the backlog — nothing is deleted.
          </p>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirmDrop(null)}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" onClick={confirmShrink}>
              Confirm
            </Button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  );
}
