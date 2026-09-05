"use client";
import { useState } from "react";
import type { TripDetail } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { Text } from "@/components/ui/text";
import { formatTripDate } from "@/lib/formatDate";
import { cn } from "@/lib/cn";

// **One control for "which days", replacing three.**
//
// Mitchell, on the PR 141 preview: *"I dont think we need the date pickers, and
// the dropdown for all days/specific day, and the range. Combine them into one
// experience. Im picturing a calendar where you pick a range, it defaults to all
// days of trip, and you can select the days."*
//
// So: a button showing the current selection, opening a grid of the trip's own
// days. Click one, click a second to reach it, click "All days" to clear.
//
// **It always writes `dates`, never `day`** — Mitchell's call when the two were
// put to him, because one control writing two different dimensions depending on
// how many cells you touched is a rule nobody can predict from the outside. The
// cost is stated rather than hidden: a `dates` filter resolves against real
// dates, so on a trip with no dates there is nothing to select and the popover
// says so instead of offering cells that would store a range matching nothing.
//
// **It still READS a stored `day`**, and clearing removes both keys. Documents
// migrated from `cost.day` and friends carry one (ADR-039's v1 → v2 step), and a
// binding the UI can no longer write must still be one the UI can see and undo —
// otherwise the migration would strand every dated page ever written.
//
// The trip's OWN days, not a month calendar. A month grid needs navigation,
// empty leading cells and a concept of "outside the trip"; a trip is a short
// list of numbered days and that is what the filter is actually over. "Day 3"
// is also the label every other surface uses for it.

/** What the widget's params say about which days, read as a range of dates. */
export interface DaysSelection {
  from: string;
  through: string;
}

/**
 * The current selection, and whether it came from a binding this control can no
 * longer produce.
 *
 * `stale` is a `day` ref pointing at a day the trip no longer has — the same
 * state the widget renders as "that day was removed". It has to be visible here
 * or the reader has no way back to All.
 */
export function daysSelectionOf(
  params: Record<string, unknown>,
  detail: TripDetail,
): { range: DaysSelection | null; legacyDay: number | null; stale: boolean } {
  const dates = params.dates as { from?: unknown; through?: unknown } | undefined;
  const range =
    typeof dates?.from === "string" && typeof dates?.through === "string"
      ? { from: dates.from, through: dates.through }
      : null;

  const ref = params.day as { kind?: string; index?: number; dayId?: string } | undefined;
  let legacyDay: number | null = null;
  let stale = false;
  if (ref?.kind === "index" && typeof ref.index === "number") {
    if (ref.index < detail.days.length) legacyDay = ref.index;
    else stale = true;
  } else if (ref?.kind === "dayId" && typeof ref.dayId === "string") {
    const index = detail.days.findIndex((d) => d.dayId === ref.dayId);
    if (index === -1) stale = true;
    else legacyDay = index;
  }
  return { range, legacyDay, stale };
}

/**
 * The button's label — what this widget is showing, in the words of the page.
 *
 * A date rather than "Day 3" when a range is set, because a range is a range of
 * DATES and printing a day number for it would claim a precision the binding
 * does not have (a range can span days the trip has since renumbered).
 */
export function daysSummary(params: Record<string, unknown>, detail: TripDetail): string {
  const { range, legacyDay, stale } = daysSelectionOf(params, detail);
  if (stale) return "That day was removed";
  if (range) return range.from === range.through ? range.from : `${range.from} – ${range.through}`;
  if (legacyDay !== null) return `Day ${legacyDay + 1}`;
  return "All days";
}

/**
 * Write a selection, or clear it.
 *
 * **Clearing removes BOTH keys**, which is what makes a migrated `day` binding
 * escapable and what keeps `{}` the one spelling of "every day". Writing a range
 * removes `day` for the same reason: two bindings for one question is a widget
 * whose answer depends on which one a resolver happens to check first.
 */
export function withDaysSelection(
  params: Record<string, unknown>,
  selection: DaysSelection | null,
): Record<string, unknown> {
  const merged = { ...params };
  delete merged.day;
  if (selection === null) delete merged.dates;
  else merged.dates = { from: selection.from, through: selection.through };
  return merged;
}

export function DaysFilter({
  params,
  detail,
  onChange,
  layout,
  id,
  label,
}: {
  params: Record<string, unknown>;
  detail: TripDetail;
  onChange: (params: Record<string, unknown>) => void;
  layout: "inline" | "stacked";
  id: string;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  // The first click of a two-click range. Local, and deliberately not written
  // to the document: a half-made range is not a filter, and storing one would
  // make the widget resolve against it between the two clicks.
  const [anchor, setAnchor] = useState<number | null>(null);
  const { range, legacyDay, stale } = daysSelectionOf(params, detail);

  const dated = detail.days.filter((day) => day.date !== null);
  const summary = daysSummary(params, detail);

  const inRange = (date: string | null): boolean =>
    date !== null && range !== null && date >= range.from && date <= range.through;

  const pick = (index: number) => {
    const date = detail.days[index]?.date;
    if (date == null) return;
    if (anchor === null) {
      // One click is a single day, which is a range whose ends are equal — the
      // shape `DateRangeRef` uses for "a single date", so there is one stored
      // form rather than two.
      setAnchor(index);
      onChange(withDaysSelection(params, { from: date, through: date }));
      return;
    }
    const anchorDate = detail.days[anchor]?.date;
    if (anchorDate == null) return;
    // Ordered here, where the two ends are two CLICKS rather than two typed
    // values: reaching backwards through a calendar is how ranges are selected
    // everywhere, and there is no "what the author typed" to preserve.
    const [from, through] = anchorDate <= date ? [anchorDate, date] : [date, anchorDate];
    setAnchor(null);
    onChange(withDaysSelection(params, { from, through }));
  };

  const trigger = (
    <Button
      id={id}
      variant="secondary"
      aria-label={label}
      aria-expanded={open}
      className={cn(
        "font-normal",
        layout === "inline" ? "h-7 px-2 py-0 text-xs" : "min-h-11 w-full justify-start",
        stale && "text-danger",
      )}
      onClick={() => setOpen((was) => !was)}
    >
      {summary}
    </Button>
  );

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setAnchor(null);
      }}
      trigger={trigger}
      align="start"
      collisionPadding={12}
      contentClassName="w-72"
    >
      <div className="flex flex-col gap-2">
        <Button
          variant={range === null && legacyDay === null && !stale ? "primary" : "secondary"}
          className="min-h-11 w-full"
          onClick={() => {
            setAnchor(null);
            onChange(withDaysSelection(params, null));
            setOpen(false);
          }}
        >
          All days
        </Button>
        {dated.length === 0 ? (
          // The cost of always writing `dates`, said out loud rather than shown
          // as cells that would store a range matching nothing.
          <Text variant="muted">
            This trip has no dates yet, so there are no days to filter by. Add a start date to the
            trip and they appear here.
          </Text>
        ) : (
          <>
            <Text variant="muted">
              {anchor === null ? "Pick a day, or pick two to select a range." : "Now pick the last day."}
            </Text>
            {/* **Three columns, not four.** Mitchell, on the preview: *"i like
                the UX, but the ui is a little lacking"*. Four cells across a
                `w-72` popover left each one about 64px wide, which is why the
                date underneath had to be squeezed to a raw `2027-06-01` — and a
                column of ISO strings is not something anyone reads, it is
                something they decode. Three cells give the date room to be a
                date. */}
            <div role="group" aria-label="Trip days" className="grid grid-cols-3 gap-1">
              {detail.days.map((day, index) => {
                const selected = inRange(day.date) || legacyDay === index;
                return (
                  <Button
                    key={day.dayId}
                    variant={selected ? "primary" : "secondary"}
                    disabled={day.date === null}
                    aria-pressed={selected}
                    className="min-h-11 flex-col gap-0 px-1 py-1 text-xs font-normal"
                    onClick={() => pick(index)}
                  >
                    <span className="font-medium">Day {index + 1}</span>
                    <span className="text-2xs text-slate">
                      {day.date === null ? "no date" : formatTripDate(day.date)}
                    </span>
                  </Button>
                );
              })}
            </div>
          </>
        )}
        {stale ? (
          // A migrated binding pointing at a deleted day. The widget beside this
          // says "that day was removed"; this is where it gets undone.
          <Text variant="muted">
            This was pointed at a day the trip no longer has. Pick another, or choose All days.
          </Text>
        ) : null}
      </div>
    </Popover>
  );
}
