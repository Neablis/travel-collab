"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
// days. Click one, click a second to reach it (or press one and drag to the
// other), click "All days" to clear.
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

  // **Press on a day and drag across the others to select them** (Mitchell,
  // PR #269 preview: *"The date picker in a widget for selecting days should
  // allow Click and drag to select multiple"*). The run from the pressed day to
  // the day under the pointer shows as selected while the drag lasts, and is
  // written ONCE on release — one edit, one undo, and the widget never resolves
  // against a half-dragged range.
  //
  // **Always a range, never a paint.** The usual paint gesture (start on an
  // unselected day and the drag selects; start on a selected one and it
  // deselects) cannot be stored: `dates` is a `DateRangeRef`, one
  // `{from, through}`, so deselecting the middle of a range is a hole the
  // document cannot hold. A drag is the two-click range in one stroke — pressed
  // day to released day, replacing what was there — which is exactly what
  // clicking those two days does.
  //
  // Pointer Events, so mouse, finger and pen are one code path. The day under
  // the pointer is hit-tested with `elementFromPoint` rather than read from the
  // event's target, because a finger's pointer is implicitly captured by the
  // cell it landed on and every move reports THAT cell (the reason `DayRiver`'s
  // touch lift hit-tests too). Window listeners rather than `setPointerCapture`:
  // capturing retargets a mouse's click onto the capturing element, and a plain
  // click on a day has to keep landing on that day.
  const [drag, setDrag] = useState<{ start: number; current: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // The click a finished drag's release produces. It is not a pick — the drag
  // already wrote the range — so it is swallowed once, and the next press clears
  // it in case that click never came (released outside the grid).
  const swallowClick = useRef(false);
  const endGesture = useRef<(() => void) | null>(null);
  // The control unmounting mid-drag leaves no listener behind.
  useEffect(() => () => endGesture.current?.(), []);

  const dayAt = (x: number, y: number): number | null => {
    if (typeof document.elementFromPoint !== "function") return null;
    const cell = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-day-index]");
    if (!cell || !gridRef.current?.contains(cell)) return null;
    const index = Number(cell.dataset.dayIndex);
    return detail.days[index]?.date != null ? index : null;
  };

  // Two days as a range, ordered: reaching backwards is as good as forwards.
  const rangeOf = (a: number, b: number): DaysSelection | null => {
    const first = detail.days[a]?.date;
    const second = detail.days[b]?.date;
    if (first == null || second == null) return null;
    return first <= second ? { from: first, through: second } : { from: second, through: first };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    swallowClick.current = false;
    if (e.button !== 0) return;
    const cell = (e.target as Element).closest<HTMLElement>("[data-day-index]");
    if (!cell) return;
    const start = Number(cell.dataset.dayIndex);
    if (detail.days[start]?.date == null) return;
    endGesture.current?.();
    const { pointerId } = e;
    let current = start;
    let moved = false;

    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      // A mouse whose button came up somewhere this window never heard about.
      if (ev.pointerType === "mouse" && ev.buttons === 0) {
        finish(false);
        return;
      }
      const over = dayAt(ev.clientX, ev.clientY);
      if (over === null || over === current) return;
      current = over;
      moved = true;
      setDrag({ start, current });
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(true);
    };
    const cancel = () => finish(false);
    const escape = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") finish(false);
    };
    function finish(commit: boolean) {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("keydown", escape);
      endGesture.current = null;
      setDrag(null);
      // A press that never left its day is a click, and `pick` does with it
      // what it always did.
      if (!commit || !moved) return;
      const selection = rangeOf(start, current);
      if (selection === null) return;
      swallowClick.current = true;
      setAnchor(null);
      onChange(withDaysSelection(params, selection));
    }
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("blur", cancel);
    window.addEventListener("keydown", escape);
    endGesture.current = cancel;
  };

  // What the cells show: the drag's run while one is under way, else the document.
  const shown = drag !== null ? rangeOf(drag.start, drag.current) : range;
  const inRange = (date: string | null): boolean =>
    date !== null && shown !== null && date >= shown.from && date <= shown.through;

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
        if (!next) {
          setAnchor(null);
          // Closed mid-drag: the drag is abandoned, not committed on a release
          // the reader can no longer see the days for.
          endGesture.current?.();
        }
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
              {anchor === null
                ? "Pick a day, or pick two or drag across them to select a range."
                : "Now pick the last day."}
            </Text>
            {/* **Three columns, not four.** Mitchell, on the preview: *"i like
                the UX, but the ui is a little lacking"*. Four cells across a
                `w-72` popover left each one about 64px wide, which is why the
                date underneath had to be squeezed to a raw `2027-06-01` — and a
                column of ISO strings is not something anyone reads, it is
                something they decode. Three cells give the date room to be a
                date. */}
            {/* `touch-none` so a finger drawn across the days selects them
                rather than scrolling (the browser cancels a pointer it takes
                for a scroll); `select-none` so a mouse drag does not also
                highlight the cells' text. */}
            <div
              ref={gridRef}
              role="group"
              aria-label="Trip days"
              className="grid touch-none select-none grid-cols-3 gap-1"
              onPointerDown={onPointerDown}
              onClickCapture={(e) => {
                if (!swallowClick.current) return;
                swallowClick.current = false;
                e.stopPropagation();
                e.preventDefault();
              }}
            >
              {detail.days.map((day, index) => {
                // A drag under way stands in for the stored selection, a legacy
                // `day` included: releasing it replaces both.
                const selected = inRange(day.date) || (drag === null && legacyDay === index);
                return (
                  <Button
                    key={day.dayId}
                    variant={selected ? "primary" : "secondary"}
                    disabled={day.date === null}
                    aria-pressed={selected}
                    data-day-index={index}
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
