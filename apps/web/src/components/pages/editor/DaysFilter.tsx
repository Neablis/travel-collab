"use client";
import { useState } from "react";
import type { DatesRef, TripDetail } from "@tc/contracts";
import { datesInclude, datesLabel } from "@tc/pages";
import { Button } from "@/components/ui/button";
import { DayGrid, dragSpan, type DayGridDrag } from "@/components/ui/day-grid";
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
// days. Click a day to add it or take it away, press one and drag to another
// for the run between them, click "All days" to clear.
//
// **It always writes `dates`, never `day`** — Mitchell's call when the two were
// put to him, because one control writing two different dimensions depending on
// how many cells you touched is a rule nobody can predict from the outside. The
// cost is stated rather than hidden: a `dates` filter resolves against real
// dates, so on a trip with no dates there is nothing to select and the popover
// says so instead of offering cells that would store dates matching nothing.
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

// Read leniently, as the range always was: a stored value is shown for what it
// says rather than re-validated here — `insertWidget` and the page's own write
// check are where a bad one is refused.
function storedDates(value: unknown): DatesRef | null {
  if (Array.isArray(value)) {
    const list = value.filter((date): date is string => typeof date === "string");
    return list.length > 0 ? list : null;
  }
  const range = value as { from?: unknown; through?: unknown } | undefined;
  return typeof range?.from === "string" && typeof range?.through === "string"
    ? { from: range.from, through: range.through }
    : null;
}

/**
 * The current selection, and whether it came from a binding this control can no
 * longer produce.
 *
 * `dates` is the stored binding — one run of days as a range, or separate days
 * as a list (`DatesRef`). `stale` is a `day` ref pointing at a day the trip no
 * longer has — the same state the widget renders as "that day was removed". It
 * has to be visible here or the reader has no way back to All.
 */
export function daysSelectionOf(
  params: Record<string, unknown>,
  detail: TripDetail,
): { dates: DatesRef | null; legacyDay: number | null; stale: boolean } {
  const dates = storedDates(params.dates);

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
  return { dates, legacyDay, stale };
}

/**
 * The button's label — what this widget is showing, in the words of the page.
 *
 * Dates rather than "Day 3" when `dates` is set, because the binding is a set
 * of DATES and printing a day number for it would claim a precision it does not
 * have (a range can span days the trip has since renumbered). Written as the
 * page writes dates — "Jun 1 – Jun 4", "Jun 2, Jun 5", "5 days" — by the same
 * `datesLabel` a widget's own title uses; it printed the raw `2027-06-01 –
 * 2027-06-04` until separate days made a list of those unreadable.
 */
export function daysSummary(params: Record<string, unknown>, detail: TripDetail): string {
  const { dates, legacyDay, stale } = daysSelectionOf(params, detail);
  if (stale) return "That day was removed";
  if (dates) return datesLabel(dates);
  if (legacyDay !== null) return `Day ${legacyDay + 1}`;
  return "All days";
}

/**
 * The trip's days `indexes` name, as the binding that stores them: `null` for
 * none, a range when they are one unbroken run of the trip's days, a list
 * otherwise.
 *
 * **A run stays a range** so the change that brought in the list moves no
 * existing document: a single day or a dragged run is written exactly as it
 * was before, and a list appears only for a selection a range cannot hold. "One
 * run" means the range from the first to the last date would select nothing
 * else — every dated day of the trip between them is picked.
 */
export function datesOfDays(detail: TripDetail, indexes: Iterable<number>): DatesRef | null {
  const picked = new Set<string>();
  for (const index of indexes) {
    const date = detail.days[index]?.date;
    if (date != null) picked.add(date);
  }
  const list = [...picked].sort();
  if (list.length === 0) return null;
  const range = { from: list[0]!, through: list[list.length - 1]! };
  const unbroken = detail.days.every((day) => !datesInclude(range, day.date) || picked.has(day.date!));
  return unbroken ? range : list;
}

/**
 * Write a selection, or clear it.
 *
 * **Clearing removes BOTH keys**, which is what makes a migrated `day` binding
 * escapable and what keeps `{}` the one spelling of "every day". Writing a
 * selection removes `day` for the same reason: two bindings for one question is
 * a widget whose answer depends on which one a resolver happens to check first.
 */
export function withDaysSelection(
  params: Record<string, unknown>,
  selection: DatesRef | null,
): Record<string, unknown> {
  const merged = { ...params };
  delete merged.day;
  if (selection === null) delete merged.dates;
  else merged.dates = Array.isArray(selection) ? [...selection] : { from: selection.from, through: selection.through };
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
  const { dates, legacyDay, stale } = daysSelectionOf(params, detail);

  const dated = detail.days.filter((day) => day.date !== null);
  const summary = daysSummary(params, detail);

  // The stored selection as the trip's days, whichever form it is in. A legacy
  // `day` counts as picked, so the first click after a migration adds to it
  // rather than silently dropping it.
  const selected = new Set<number>();
  detail.days.forEach((day, index) => {
    if (dates !== null && datesInclude(dates, day.date)) selected.add(index);
  });
  if (legacyDay !== null) selected.add(legacyDay);

  // The dated days from `a` to `b`, inclusive and in either direction.
  const run = (a: number, b: number): number[] => {
    const { first, last } = dragSpan({ start: a, current: b });
    return Array.from({ length: last - first + 1 }, (_, i) => first + i).filter(
      (index) => detail.days[index]?.date != null,
    );
  };

  // **Press on a day and drag across the others to select them** (Mitchell,
  // PR #269 preview: *"The date picker in a widget for selecting days should
  // allow Click and drag to select multiple"*). The run from the pressed day to
  // the day under the pointer shows as selected while the drag lasts, and is
  // written ONCE on release — one edit, one undo, and the widget never resolves
  // against a half-dragged range. The gesture itself is `DayGrid`'s, shared
  // with the Keep-a-day picker (Mitchell, PR #269 preview: *"re-use components
  // and see similiar functionality using the same style and code"*).
  //
  // **A drag is a run, replacing what was there — not a paint.** The Keep
  // dialog's drag paints (started on an unselected day it selects the span,
  // started on a selected one it deselects it), and since `dates` can hold
  // separate days this one could too. It does not, because here a click
  // already adds and removes one day at a time: the drag is the other gesture
  // in Mitchell's *"either drag and select, or click one offs"*, and it means
  // "these days", pressed day to released day.
  const commitDrag = (drag: DayGridDrag) => {
    const selection = datesOfDays(detail, run(drag.start, drag.current));
    if (selection === null) return;
    setLastPicked(null);
    onChange(withDaysSelection(params, selection));
  };

  // What a cell shows: the drag's run while one is under way, else the
  // document. A drag under way stands in for the stored selection, a legacy
  // `day` included: releasing it replaces both.
  const pressed = (index: number, drag: DayGridDrag | null): boolean => {
    if (drag === null) return selected.has(index);
    return run(drag.start, drag.current).includes(index);
  };

  // **A click adds that one day, or takes it away.** Mitchell, PR #269
  // preview: *"get rid of the 'First click start, second click end, select all
  // elements between' this should be either drag and select, or click one
  // offs"*. A click first replaced the selection with the day clicked, because
  // `dates` could only hold one range; asked whether it should become a list so
  // Day 2 and Day 5 could be picked together, he answered *"Yes go ahead"*. So a
  // click toggles one day in the set, and taking the last one away is All days
  // — nothing stored — rather than an empty filter that shows nothing.
  //
  // **Shift-click ADDS the run from the last day picked.** Without it the
  // keyboard could not select a run at all — a drag needs a pointer. It adds
  // rather than replaces because a click here already means "and this one":
  // Day 2, then Shift on Day 4, then Day 7, then Shift on Day 9 is two runs,
  // which is a set the keyboard could not otherwise build. Replacing is what a
  // drag, or "All days" first, is for.
  const pick = (index: number, extend: boolean) => {
    if (detail.days[index]?.date == null) return;
    const next = new Set(selected);
    if (extend && lastPicked !== null) {
      for (const day of run(lastPicked, index)) next.add(day);
    } else {
      setLastPicked(index);
      if (next.has(index)) next.delete(index);
      else next.add(index);
    }
    onChange(withDaysSelection(params, datesOfDays(detail, next)));
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
          variant={dates === null && legacyDay === null && !stale ? "primary" : "secondary"}
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
          // as cells that would store dates matching nothing.
          <Text variant="muted">
            This trip has no dates yet, so there are no days to filter by. Add a start date to the
            trip and they appear here.
          </Text>
        ) : (
          <>
            <Text variant="muted">Click days one at a time, or drag across several.</Text>
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
