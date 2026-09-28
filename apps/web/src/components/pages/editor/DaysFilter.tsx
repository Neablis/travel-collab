"use client";
import { useState } from "react";
import type { TripDetail } from "@tc/contracts";
import { Button } from "@/components/ui/button";
import { DayGrid, type DayGridDrag } from "@/components/ui/day-grid";
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
// days. Click a day for that day, press one and drag to another for the run
// between them, click "All days" to clear.
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
  // The last day picked by a click, so Shift can reach from it. Local and never
  // written: it is where the next Shift-click starts, not part of the filter.
  const [lastPicked, setLastPicked] = useState<number | null>(null);
  const { range, legacyDay, stale } = daysSelectionOf(params, detail);

  const dated = detail.days.filter((day) => day.date !== null);
  const summary = daysSummary(params, detail);

  // **Press on a day and drag across the others to select them** (Mitchell,
  // PR #269 preview: *"The date picker in a widget for selecting days should
  // allow Click and drag to select multiple"*). The run from the pressed day to
  // the day under the pointer shows as selected while the drag lasts, and is
  // written ONCE on release — one edit, one undo, and the widget never resolves
  // against a half-dragged range. The gesture itself is `DayGrid`'s, shared
  // with the Keep-a-day picker (Mitchell, PR #269 preview: *"re-use components
  // and see similiar functionality using the same style and code"*).
  //
  // **Always a range, never a paint.** The usual paint gesture (start on an
  // unselected day and the drag selects; start on a selected one and it
  // deselects) cannot be stored: `dates` is a `DateRangeRef`, one
  // `{from, through}`, so deselecting the middle of a range is a hole the
  // document cannot hold. A drag is a range — pressed day to released
  // day, replacing what was there. (`KeepDayDialog` drags the same way, and
  // there a click toggles a day in and out of a SET, which this cannot store.)

  // Two days as a range, ordered: reaching backwards is as good as forwards.
  const rangeOf = (a: number, b: number): DaysSelection | null => {
    const first = detail.days[a]?.date;
    const second = detail.days[b]?.date;
    if (first == null || second == null) return null;
    return first <= second ? { from: first, through: second } : { from: second, through: first };
  };

  const commitDrag = (drag: DayGridDrag) => {
    const selection = rangeOf(drag.start, drag.current);
    if (selection === null) return;
    setLastPicked(null);
    onChange(withDaysSelection(params, selection));
  };

  // What a cell shows: the drag's run while one is under way, else the
  // document. A drag under way stands in for the stored selection, a legacy
  // `day` included: releasing it replaces both.
  const pressed = (index: number, drag: DayGridDrag | null): boolean => {
    const date = detail.days[index]?.date ?? null;
    const shown = drag !== null ? rangeOf(drag.start, drag.current) : range;
    const inRange = date !== null && shown !== null && date >= shown.from && date <= shown.through;
    return inRange || (drag === null && legacyDay === index);
  };

  // **A click is that one day; a drag is a run.** Mitchell, PR #269 preview:
  // *"get rid of the 'First click start, second click end, select all elements
  // between' this should be either drag and select, or click one offs"*. The
  // two-click range made every click ambiguous — the same click meant "this
  // day" or "the end of a range" depending on a hidden state the helper line
  // had to narrate ("Now pick the last day."). Now a click always means the day
  // clicked, and clicking the day that is already the whole selection clears
  // back to All days, so a click is also how a one-off is undone.
  //
  // **Shift-click still reaches from the last day picked**, silently. Without
  // it the keyboard could not select a run at all — a drag needs a pointer —
  // and it is the convention every list and calendar already uses, so it needs
  // no line of copy to teach it.
  const pick = (index: number, extend: boolean) => {
    const date = detail.days[index]?.date;
    if (date == null) return;
    if (extend && lastPicked !== null) {
      const reach = rangeOf(lastPicked, index);
      if (reach !== null) onChange(withDaysSelection(params, reach));
      return;
    }
    setLastPicked(index);
    // One day is a range whose ends are equal — the shape `DateRangeRef` uses
    // for "a single date", so there is one stored form rather than two.
    const alreadyJustThis = legacyDay === null && range !== null && range.from === date && range.through === date;
    onChange(withDaysSelection(params, alreadyJustThis ? null : { from: date, through: date }));
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
        // Closed mid-drag: the grid unmounts with the popover's content,
        // and `DayGrid` abandons a drag it is unmounted in the middle of.
        if (!next) setLastPicked(null);
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
            setLastPicked(null);
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
            <Text variant="muted">Click a day, or drag across several.</Text>
            {/* **Three columns, not four.** Mitchell, on the preview: *"i like
                the UX, but the ui is a little lacking"*. Four cells across a
                `w-72` popover left each one about 64px wide, which is why the
                date underneath had to be squeezed to a raw `2027-06-01` — and a
                column of ISO strings is not something anyone reads, it is
                something they decode. Three cells give the date room to be a
                date. */}
            <DayGrid
              label="Trip days"
              count={detail.days.length}
              columns={3}
              selectable={(index) => detail.days[index]?.date != null}
              pressed={pressed}
              onPick={pick}
              onDragCommit={commitDrag}
              cell={(index) => {
                const day = detail.days[index]!;
                return {
                  key: day.dayId,
                  title: `Day ${index + 1}`,
                  detail: day.date === null ? "no date" : formatTripDate(day.date),
                };
              }}
            />
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
