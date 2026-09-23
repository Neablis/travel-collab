"use client";

import { useEffect, useState } from "react";
import type { TripCommand, TripDetail } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover } from "@/components/ui/popover";
import { cn } from "@/lib/cn";
import { addDaysIso, parseIsoDateUtc } from "@/lib/dates";
import { formatTripDate, formatTripDateWithYear } from "@/lib/formatDate";
import { chipModel } from "@/lib/dayChips";

/** The three figures Trip settings states under "Trip overview". */
export type TripCounts = { days: number; stops: number; cities: number };

// The pill itself stopped stating these in SPEC §35.3 (see below); Trip
// settings is now their only reader, and the history that follows is why they
// were there first.
//
// Exported because this pill is HIDDEN below 768px now (TripHeader), and the
// same three counts have to stay readable in Trip settings or hiding it would
// silently cost them. Mitchell, Vercel toolbar comment on
// `/trips/:id?lens=Map&view=Calendar` at 411x760: "all three columns from
// share, trip overview to budget are really crowded and ugly on mobile, if we
// hid them here would they still be accessible in trip settings?" — for the
// stop and city counts the honest answer was *no*, nothing in the sheet
// showed them, so they moved there before anything was hidden here.
//
// One rule called twice, not a second derivation in the sheet: `chipModel` is
// where a day's city is decided (it walks that day's activities and resolves
// one city per day), so "how many cities" is only well defined in terms of it.
// A hand-rolled count in SettingsSheet would be free to disagree with the pill
// about the same trip, which is exactly the kind of drift that makes the
// settings copy untrustworthy the first time the two numbers differ.
export function tripCounts(detail: TripDetail): TripCounts {
  const cities = new Set(chipModel(detail).map((d) => d.city).filter((c): c is string => c !== null));
  return {
    days: detail.days.length,
    stops: detail.days.reduce((sum, d) => sum + d.activityIds.length, 0),
    cities: cities.size,
  };
}

/**
 * "Fri, Oct 9 – Fri, Oct 16", or "No dates set".
 *
 * Exported for the same reason `tripCounts` above is: the pill that used to be
 * this string's only reader is hidden below 768px, and SPEC §23 puts the date
 * range back on a phone as its own line under the trip title (`TripHeader`).
 * Lifted out of the pill's body rather than written a second time there —
 * `SettingsSheet`'s `datesLabel` is already a second copy of these three rules
 * (no dates / one date / a range), and a third would be the point at which the
 * header and the sheet start disagreeing about the same trip.
 *
 * Takes the detail, not two dates, because the range is derived from the DAYS:
 * `detail.startDate` is only the fallback for a trip whose days have not been
 * laid out yet.
 *
 * **Why `??` is safe on `days[0]?.date`, which is nullable.** It reads as
 * though an undated day 0 would borrow `startDate` and print a date for a trip
 * that shows none — CodeRabbit read it exactly that way on PR #148. The state
 * is not producible: `deriveDayDates` (`packages/domain/src/trip/dates.ts:86`)
 * returns all-null when `startDate` is null and a date for EVERY day when it is
 * not, so `days[0].date === null` implies `startDate === null` and the fallback
 * yields null either way. The contract says the same
 * (`packages/contracts/src/globals.ts:43` — "the day's date, or nothing if the
 * trip has no start date").
 *
 * Narrowing this to `days.length === 0 ? detail.startDate : …` would be a
 * regression rather than a tightening: in the one case it changes it prints
 * "No dates set" for a trip that HAS a start date, which is what
 * `SettingsSheet`'s `datesLabel` renders as the date. The header and the sheet
 * would then disagree about the same trip — the thing lifting this helper out
 * of the pill was meant to stop.
 */
export function tripDateRange(detail: TripDetail): string {
  const days = detail.days;
  const start = days[0]?.date ?? detail.startDate;
  const end = days[days.length - 1]?.date ?? null;
  if (start === null) return "No dates set";
  if (end === null || end === start) return formatTripDate(start);
  return `${formatTripDate(start)} – ${formatTripDate(end)}`;
}

// A native date input's value is "" or a whole date, but "2027-02-31" still
// passes the contract's shape-only regex, and `parseIsoDateUtc` throws on it
// rather than rolling it over (lib/dates.ts). So "is this a day" is asked of
// the parser that `addDaysIso` below will use, not of a second regex.
function isCalendarDate(value: string): boolean {
  try {
    parseIsoDateUtc(value);
    return true;
  } catch {
    return false;
  }
}

// SPEC §35.3: the pill is the dates and nothing else. The day, stop and city
// counts it used to carry are the Overview's first sentence, so they were said
// twice; `tripCounts` above stays for Trip settings, which still states them.
// No member avatars either — dropped in the 2026-08-30 pass ("Can we drop this
// ownership tile all togther? DA?"); who is on the trip is Travellers' answer.
//
// It is also the way in to moving the trip (M27 D5): a button opening a small
// popover over `SetTripStartDate`, the command Trip settings' Dates row sends.
// Not `TripDateControl` itself — that is the settings version, with its own
// copy and a clear-date ✕ — but the same rule: it commits on change, so Done
// only closes. A viewer gets the range as plain text: no caret, no popover,
// and nothing that announces itself as a control.
//
// An undated trip still gets the button. "No dates set" is exactly the state
// the popover fixes, so it opens on an empty input rather than withholding the
// one control in the header that can set a date.
export function TripMetaPill({
  detail,
  readOnly,
  onCommand,
}: {
  detail: TripDetail;
  readOnly: boolean;
  /** The one command this pill sends — narrowed so it cannot grow a second. */
  onCommand: (command: Extract<TripCommand, { type: "SetTripStartDate" }>) => void;
}) {
  const [open, setOpen] = useState(false);
  const dateRange = tripDateRange(detail);
  const start = detail.startDate ?? "";
  const [pendingStart, setPendingStart] = useState(start);
  // Re-seeded whenever the trip's start moves, from here or from anyone else —
  // `TripDateControl`'s reasoning for its own copy: fresher server data beats
  // an unsaved local value.
  useEffect(() => setPendingStart(start), [start]);

  const body = (
    <>
      <span aria-hidden className="size-2.25 shrink-0 rounded-full bg-brand" />
      <span className="font-mono text-xs text-ink">{dateRange}</span>
    </>
  );
  const shell = "inline-flex items-center gap-2 rounded-full border border-hairline bg-surface py-1.25 pl-3 pr-3.5";

  if (readOnly) return <div className={shell}>{body}</div>;

  const changeStart = (value: string) => {
    setPendingStart(value);
    if (!isCalendarDate(value) || value === start) return;
    onCommand({ type: "SetTripStartDate", tripId: detail.tripId, startDate: value });
  };
  // From the input, not the trip's last day, so the end moves as the date is
  // picked rather than a round-trip later. A trip with no days ends the day it
  // starts.
  const end = isCalendarDate(pendingStart) ? addDaysIso(pendingStart, Math.max(detail.days.length - 1, 0)) : null;
  const inputId = `trip-start-${detail.tripId}`;

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="start"
      contentClassName="w-80"
      trigger={
        // `Button` restyled to the pill, the same way `BudgetChip`'s "Set a
        // budget" beside it is: the pill's own shape wins over the variant's
        // height and radius, and the variant keeps the focus ring.
        <Button
          type="button"
          variant="secondary"
          title="Change the start date"
          aria-label={`Trip dates: ${dateRange}. Change the start date`}
          className={cn(shell, "h-auto font-normal hover:border-border-strong hover:bg-surface")}
        >
          {body}
          <svg aria-hidden width="10" height="10" viewBox="0 0 10 6" fill="none" className="shrink-0 text-slate">
            <path d="M1 1.5 5 5 9 1.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Button>
      }
    >
      <div className="flex flex-col gap-2.5">
        <Label htmlFor={inputId} className="font-semibold text-ink">
          Start date
        </Label>
        <div className="flex flex-wrap items-center gap-2.5">
          <Input id={inputId} type="date" value={pendingStart} onChange={(e) => changeStart(e.target.value)} className="w-auto" />
          {end !== null && <span className="font-mono text-sm text-slate">{`→ ${formatTripDateWithYear(end)}`}</span>}
        </div>
        <span className="text-xs leading-normal text-slate">
          Every day moves with it. Order, times and notes stay as they are.
        </span>
        <div className="flex justify-end">
          <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      </div>
    </Popover>
  );
}
