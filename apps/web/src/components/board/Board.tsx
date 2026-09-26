"use client";

import { cn } from "@/lib/cn";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollForElements, autoScrollWindowForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import type { ActivityTag, TimeWindow, TripDetail } from "@tc/contracts";
import { dayLabel } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Toast } from "@/components/ui/toast";
import { useTimeFormat } from "@/components/account/PreferencesProvider";
import { toClockLabel } from "@/lib/time";
import { useEditor } from "@/components/trip/context/EditorHost";
import { chipModel, cityFor } from "@/lib/dayChips";
import { centralDayIndex, READING_LINE, stepDay } from "@/components/trip/centralDay";
import {
  useDayScrollSpy,
  useFollowFocusedDay,
  type DaySync,
} from "@/components/trip/context/FocusProvider";
import { badgeableConflictSubjects, overlapsForDay, type Overlap } from "@/components/lenses/overlapData";
import { dayAccents } from "@/lib/dayAccent";
import { stopsForDay } from "@/lib/savedStops";
import { KeepDayFlag } from "@/components/trip/KeepDayFlag";
import { Column, DAY_COLUMN_WIDTH_PX } from "./Column";
import type { RiverGestures } from "./DayRiver";
import { ConflictBanner } from "./ConflictBanner";
import { type PlaceOutcome, resolveDrop } from "./resolveDrop";
import { riverAxis } from "./riverLayout";

// Phase 6, Step 3 item 5: the trailing "One more day?" column, which replaces
// the loose "+ Add day" button that used to trail the row. Shaped like a day
// column (same 268px, dashed instead of tinted) so it reads as "the trip could
// grow by one more of these" rather than as a stray control parked next to the
// plan. It carries the plan's terminal actions: a real "Add a day" (the AddDay
// command TripBoardScreen already dispatches), "Add a saved day" (a slot, see
// below) and a link into the public library.
//
// It began as the Day-columns twin of the Timeline lens's full-bleed
// end-of-trip block, and deliberately shared no component with it — same copy
// and actions, different shape (a horizontal section with body copy and a
// shortcut grid, against this 268px vertical column). SPEC §24 deleted that
// lens, and the block's orphaned module went in KI-2026-09-20-b, so this
// column is now the only end-of-trip surface in the app.
//
// Design values from the phase file's "Design values" note: 15px/600
// --color-ink title, dashed, matching the day columns' 268px width. The
// design's own trailing column (`Trip Planner Redesign.dc.html:630-650`)
// additionally carries a "Saved days keep their order and gaps" line and the
// three end-of-trip Playbook shortcuts; neither is in this phase's copy table,
// so neither is invented here.
function OneMoreDayColumn({ onAddDay, addSavedDay, fullWidth = false }: { onAddDay: () => void; addSavedDay?: ReactNode; fullWidth?: boolean }) {
  return (
    <section
      data-testid="one-more-day-column"
      className={cn(
        "flex flex-col gap-2.5 rounded-2xl border border-dashed border-border-strong p-3.5",
        // `row-span-4`: the desktop row is a four-row grid now (M29 part 2),
        // and this column stands as tall as the days beside it, as it did in
        // the flex row.
        fullWidth ? "w-full" : "row-span-4 shrink-0",
      )}
      // eslint-disable-next-line no-restricted-syntax -- 268px matches the day columns' width, which has no token equivalent (Column.tsx carries the same escape hatch and owns the constant)
      style={fullWidth ? undefined : { width: DAY_COLUMN_WIDTH_PX }}
    >
      <span
        className="font-semibold text-ink"
        // eslint-disable-next-line no-restricted-syntax -- the design's 15px title falls between text-base (14px) and text-md (16px); no token equals it
        style={{ fontSize: "15px" }}
      >
        One more day?
      </span>
      <Button variant="primary" onClick={onAddDay} className="w-full justify-center">
        Add a day
      </Button>
      {/* **The real "Add a saved day", and it is here because SPEC §24 left it
          nowhere else.** The note that used to sit here said the control lived
          in `trip/EndOfTrip.tsx`, "reachable from the Timeline lens", and that
          the library was one link away in the meantime. §24 deleted that lens,
          which took `EndOfTrip` — and with it this button, its dialog and the
          whole insert half of the keep-a-day loop — out of the running app
          entirely. Same shape as the Keep pennant on `Column`: a feature that
          lived in one lens and was deleted by deleting the lens.

          A SLOT, for the reason the old note gave and which still holds:
          `AddSavedDayButton` reads `useTrip()`, and `Board` is a props-only
          component its own tests render with no provider. `TripBoardScreen` is
          inside the provider already, so it passes the button in.

          The library LINK stays beside it rather than being replaced by it.
          They are not the same action — this inserts a saved day into this
          trip, that navigates to the Playbooks page to browse — so R4 ("no
          duplicated information") does not reach it. */}
      {addSavedDay}
      <Link
        href="/playbooks"
        className="rounded-md px-2 py-1 text-center text-sm text-slate hover:underline"
      >
        Take a day from the library
      </Link>
    </section>
  );
}

export type BoardCallbacks = {
  onMove: (activityId: string, toDayId: string | null, position: number) => void;
  /** A drop on the unscheduled rack: off the schedule, times stripped. */
  onUnschedule: (activityId: string) => void;
  /**
   * A drop at a time on a day's river (M29 part 3): to that day, at that time,
   * as ONE change — one undo puts back both (`placeCommands`).
   */
  onPlace: (outcome: PlaceOutcome) => void;
  /** A block's bottom edge was dragged: the stop's new window. */
  onRetime: (activityId: string, timeWindow: TimeWindow) => void;
  /** Raised for every drag, so the rack's disclosure reducer can auto-open. */
  onDragStart: () => void;
  /** Raised on drop *and* on an Escape-cancelled drag — pdnd runs the same path. */
  onDragEnd: () => void;
  /** Selects a day by index — the same state the day chips above drive. */
  // `null` clears the focus — see Column's header comment and DayChips.
  onSelectDay: (index: number | null) => void;
  onAddDay: () => void;
  onRemoveDay: (dayId: string) => void;
  // `onAddActivity`/`onUpdateActivity` taking an `ActivityFormValue` were
  // declared here when this file was extracted from `TripBoardScreen`
  // (5a786a9) and were never called by anything, in any version — born dead
  // rather than abandoned. Editing goes through `ActivityEditorSheet`, which
  // owns the form and dispatches its own commands. Removed 2026-09-22 after
  // `git log -S` confirmed no call site has ever existed: a second, unreachable
  // copy of the form-to-command mapping is exactly how a field gets silently
  // dropped, which is what CodeRabbit found on PR #201.
  //
  // `Column`'s own `onAddActivity` is unrelated and still live: it takes no
  // arguments and opens the sheet.
  onRemoveActivity: (activityId: string) => void;
  onDismissConflict: (conflictId: string) => void;
};

/**
 * Renders a horizontally scrollable board of trip day columns.
 *
 * Supports day selection, activity editing and removal, conflict handling,
 * drag-and-drop activity scheduling, optional tag focus, and read-only
 * presentation.
 *
 * @param trip - The trip data displayed by the board
 * @param callbacks - Handlers for board interactions
 * @param focusedDay - Index of the selected day
 * @param focusedTag - Tag used to focus matching activities
 * @param onToggleTag - Handler for toggling tag focus
 * @param readOnly - Whether to hide controls that modify the trip
 * @param sync - Optional handle for synchronizing scrolling with day selection
 * @param keepFlag - Optional "keep this day" pennant, rendered in each day's header
 * @param addSavedDay - Optional control for inserting a saved day, after the last column
 */
export function Board({
  trip,
  callbacks,
  focusedDay = null,
  focusedTag = null,
  onToggleTag,
  readOnly = false,
  sync,
  addSavedDay,
  oneDay = false,
}: {
  trip: TripDetail;
  callbacks: BoardCallbacks;
  /**
   * **One day at a time, at full width** — M26 link 13, SPEC §13.4: *"The day
   * rail never collapses … A phone can hold one day at a time; the rail is how
   * you change which."*
   *
   * A phone was rendering the DESKTOP board: `DAY_COLUMN_WIDTH_PX` is a fixed
   * 268px at every width, inside a horizontally scrolling row, so a 390px
   * screen showed one and a bit columns and a stop card measured 241px with
   * 141px of text in it. The card was narrow because of a layout constant, not
   * because the screen is.
   *
   * **Not a phone-only view.** Same `Column`, same cards, same drag logic, same
   * `focusedDay` — a count of one and a different width. §13 calls that a
   * variant layer, and the milestone's own instruction was not to build a
   * fallback view to paper over KI-046.
   *
   * A prop rather than `useIsPhone()` here, because this component is
   * props-only by design and its tests render it with no provider.
   */
  oneDay?: boolean;
  /**
   * The "Add a saved day" control for the trailing "One more day?" column.
   *
   * A slot because the real one (`trip/AddSavedDayButton`) reads `useTrip()`
   * and this component is props-only — its own tests render it with no
   * provider. See the note at its render site for why it has to live here at
   * all now.
   */
  addSavedDay?: ReactNode;
  /**
   * A board that shows the plan and offers nothing that changes it — a
   * viewer's, or the public demo's (ADR-031).
   *
   * Every write affordance is dropped here rather than disabled, and the
   * drag-and-drop wiring goes with them: `TripProvider` already refuses a
   * viewer's command, so a drag would pick a card up, move it, and snap it
   * back — the exact behaviour the provider's own comment says it exists to
   * prevent. Passing the callbacks through unchanged and hiding only the
   * buttons would have left that one path live.
   */
  readOnly?: boolean;
  /** Index of the focused day, or null. Owned by TripBoardScreen's useFocus,
      the same value the day chips read — passed in rather than read from
      context here so Board stays renderable on its own in tests. */
  focusedDay?: number | null;
  /** SPEC §11's focused tag, or null — same ownership and same reasoning as
      `focusedDay` above. Off-tag stops dim to 32%; nothing is removed. */
  focusedTag?: ActivityTag | null;
  /** Toggles that focus from a stop's own chip. */
  onToggleTag?: (tag: ActivityTag) => void;
  /**
   * This row's half of the day-sync contract (`FocusProvider`'s header):
   * scrolling the columns moves the selection, and a day selected anywhere else
   * scrolls its column back into view here.
   *
   * A handle passed in rather than `useDaySync()` read from context, for the
   * same reason `focusedDay` is a prop — Board stays renderable on its own in
   * tests, which construct it with no provider. Optional: without it the
   * columns still render and still select, they just do not scroll-sync.
   */
  sync?: DaySync;
}) {
  const { openCreate, openEdit } = useEditor();

  // The horizontal twin of the timeline's scroll spy, and the "Left/Right in
  // the days column" half of the same request (Mitchell, 2026-09-01). The
  // columns scroll inside their OWN box rather than the window, so the viewport
  // here is that box and the reading line is its true centre — see
  // `READING_LINE` for why the two axes differ.
  const scrollRef = useRef<HTMLDivElement>(null);
  const columnRefs = useRef<Array<HTMLElement | null>>([]);
  // One stable callback per day index. Column memoises its section ref on this
  // prop, so an inline arrow would detach and re-attach that ref — and run its
  // setState — on every Board render.
  const dayCount = trip.days.length;
  const columnRefSetters = useMemo(
    () =>
      Array.from({ length: dayCount }, (_, index) => (node: HTMLElement | null) => {
        columnRefs.current[index] = node;
      }),
    [dayCount],
  );

  const onScroll = useDayScrollSpy(sync, () => {
    const box = scrollRef.current;
    if (box === null) return null;
    const boxRect = box.getBoundingClientRect();
    const spans: { start: number; size: number }[] = [];
    for (let index = 0; index < trip.days.length; index++) {
      const rect = columnRefs.current[index]?.getBoundingClientRect();
      // A day whose column has not mounted yet: bail rather than measure a
      // shorter list, which would map positions onto the wrong indexes.
      if (rect === undefined) return null;
      spans.push({ start: rect.left, size: rect.width });
    }
    // Whether this box is scrolled hard to an end. Without it the first and
    // last columns are unreachable: they cannot bring their centres to the
    // reading line, so nearest-to-the-line never names them (2026-09-06
    // preview feedback — "impossible to scroll right all the way to day 14 …
    // same with day 1"). 1px of slack because scrollLeft is fractional under
    // zoom and on trackpads, where an exact equality never lands.
    const maxScroll = box.scrollWidth - box.clientWidth;
    return centralDayIndex(
      { start: boxRect.left, size: boxRect.width },
      spans,
      READING_LINE.horizontal,
      { atStart: box.scrollLeft <= 1, atEnd: box.scrollLeft >= maxScroll - 1 },
    );
  });

  // Contract clauses 2 and 3: a day picked on the chips row above (or arrowed
  // to below, which is an explicit pick) centres its column here, and switching
  // to this lens arrives already scrolled to the selected day.
  //
  // **The column's HEADER, not the column.** The measurement above reads the
  // column — it is the day's horizontal extent and that is what a reading line
  // is measured against — but the thing scrolled into view is the header,
  // because `scrollIntoView` moves every scrollable ancestor including the
  // page, and a day column is never small enough for `block: "nearest"` to
  // leave the page alone. See `Column`'s `data-day-header` for the measured
  // numbers and the report. Horizontally the two are the same element: the
  // header spans the column's width, so `inline: "center"` lands on the same
  // `scrollLeft`.
  useFollowFocusedDay(sync, focusedDay, trip.days.length, (index) =>
    columnRefs.current[index]?.querySelector("[data-day-header]"),
  );

  // **The row's scrollbar, pinned to the bottom of the viewport**
  // (KI-2026-09-22-b). The row's own scrollbar sits on its bottom inside edge,
  // and the row is as tall as its tallest column — which on a desktop with a
  // few stops a day is below the fold, ~300px down at 1920×919. On a mouse-only
  // desktop (Windows Chrome, classic scrollbars, no horizontal wheel) the one
  // pointer affordance for "scroll right" was off screen on load (Mitchell,
  // PR #201's preview: "I have to click in the above bar").
  //
  // So the row's native bar is hidden (`.day-columns-row`, globals.css) and
  // this second, empty scroller stands in for it: the same width as the row,
  // holding a spacer as wide as the row's content, `position: sticky` to the
  // viewport bottom. It sits at the viewport bottom while the row runs past
  // the fold and comes to rest directly under the row once the row's bottom
  // is on screen — one scrollbar, always reachable. The rejected alternatives
  // are recorded in the KI's resolved entry.
  //
  // The two mirror each other's `scrollLeft`. `echoes` counts the scroll
  // events the row's own writes into the bar still owe, so the bar ignores
  // them rather than writing them back: without that, a smooth
  // `scrollIntoView` on the row (the day-sync follow above) stops dead after
  // its first frame, because any write to the row's `scrollLeft`, even of the
  // value it already holds, cancels a smooth scroll in flight (measured
  // 2026-09-25 with the guard removed: the row stopped at 3px of 2316).
  // Chromium delivers the scroll event a handler's write raises within the
  // same dispatch pass, so the counter settles every frame; a bar drag
  // sampled per frame never stepped back or lost a step (m10-growth's "never
  // back a frame"). A drag of the bar itself owes nothing, and moves the
  // row — which then runs the spy above, exactly as a drag of the row's own
  // scrollbar would.
  const barRef = useRef<HTMLDivElement>(null);
  const barSpacerRef = useRef<HTMLDivElement>(null);
  const echoes = useRef(0);

  const mirrorRowIntoBar = useCallback(() => {
    const row = scrollRef.current;
    const bar = barRef.current;
    if (row === null || bar === null) return;
    const before = bar.scrollLeft;
    bar.scrollLeft = row.scrollLeft;
    // Only a write that moved the bar raises a scroll event to wait for.
    if (bar.scrollLeft !== before) echoes.current += 1;
  }, []);

  const onRowScroll = useCallback(() => {
    onScroll();
    mirrorRowIntoBar();
  }, [onScroll, mirrorRowIntoBar]);

  const onBarScroll = useCallback(() => {
    if (echoes.current > 0) {
      echoes.current -= 1;
      return;
    }
    const row = scrollRef.current;
    const bar = barRef.current;
    if (row === null || bar === null) return;
    row.scrollLeft = bar.scrollLeft;
  }, []);

  // The spacer tracks the row's content width: a day added or removed, the
  // trailing column appearing, or the row itself resizing (the assistant rail
  // opening shrinks it). Written straight to the DOM rather than through
  // state — it is a measurement, and re-rendering every column per resize
  // would buy nothing.
  useLayoutEffect(() => {
    const row = scrollRef.current;
    const spacer = barSpacerRef.current;
    if (oneDay || row === null || spacer === null) return;
    const measure = () => {
      spacer.style.width = `${row.scrollWidth}px`;
      mirrorRowIntoBar();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [oneDay, readOnly, trip.days.length, mirrorRowIntoBar]);

  // **Dragging a card toward an off-screen day scrolls the row**
  // (KI-2026-09-25-c). The window was the only thing registered for
  // drag auto-scroll (see the monitor below), and the row scrolls in its own
  // box, so holding a card at the row's right edge moved nothing — apart from
  // the browser's native drag auto-scroll, which Chromium only starts within a
  // few pixels of the edge (measured: 8px scrolled, 60px did not). pdnd's
  // element auto-scroll engages across a band a quarter of the row wide, capped
  // at 180px.
  //
  // **This only works while `@atlaskit/pragmatic-drag-and-drop` and the
  // auto-scroll package resolve to ONE copy of the core.** The auto-scroll
  // package listens through its own import of the core's element adapter; when
  // web pinned core 2.x and auto-scroll brought 3.x, the draggables here spoke
  // to one adapter and auto-scroll to another, so it never saw a drag. By the
  // same mechanism the window auto-scroll below was dead too, for as long as
  // the lockfile held both copies. Keep web's core range the one
  // auto-scroll depends on; `scripts/check-singletons.mjs` fails `pnpm lint`
  // if the lockfile holds two (KI-2026-09-25-g).
  //
  // The stand-in bar needs nothing extra: these are ordinary writes to the
  // row's `scrollLeft`, so `onRowScroll` mirrors them like any other scroll.
  // Not on the phone's one-day column, which does not scroll sideways (and
  // which pdnd would warn about as a non-scrollable registration).
  useEffect(() => {
    const row = scrollRef.current;
    if (oneDay || row === null) return;
    return autoScrollForElements({ element: row });
  }, [oneDay]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      // A modified arrow is somebody's own shortcut, and an arrow inside a
      // text field is a caret move. Neither is a day change. (No column
      // currently holds a text field; the guard is here so one added later
      // does not silently start stealing keystrokes.)
      if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;

      const next = stepDay(focusedDay, event.key === "ArrowRight" ? 1 : -1, trip.days.length);
      if (next === null) return;
      // Claimed for EVERY handled arrow, including one that does not move the
      // selection — the two boundary cases, ArrowLeft on day 1 and ArrowRight
      // on the last day. CodeRabbit, reviewing this branch: the old
      // `if (next === null || next === focusedDay) return;` returned BEFORE
      // this line at both ends, so the browser scrolled this box natively
      // instead — and the spy above then replaced day 1 with whatever landed on
      // the reading line. An arrow key that means "you are already at the end"
      // must still be ours, or the selection walks off the end anyway by a
      // different route. `DayChips`'s own arrow handler already got this right
      // (it preventDefaults before the equality check); the two now read the
      // same and mean the same.
      event.preventDefault();
      if (next === focusedDay) return;
      // Explicit, so it really is a selection and not a reading position: the
      // person pressed a key naming a day. Bringing it into view is the
      // contract's clause 2 (`FocusProvider`) and happens in the follow effect
      // above — for this column AND for the chip above it — rather than in a
      // scroll call of this handler's own.
      callbacks.onSelectDay(next);
    },
    [callbacks, focusedDay, trip.days.length],
  );

  // Every day's live time-overlaps, flattened to one lookup keyed by the stop
  // the warning attaches to — the later one, the stop that would move to fix
  // it — which is where a block's dismiss sits. A stop can be the later half
  // of more than one crossing pair and has room for one dismiss, so the first
  // wins; the other pair is still drawn (see `overlapPartners` below) and
  // dismissable from the banner.
  const overlapsByActivity = useMemo(() => {
    const byActivity = new Map<string, Overlap>();
    for (const day of trip.days) {
      for (const overlap of overlapsForDay(trip, day.dayId)) {
        if (!byActivity.has(overlap.laterActivityId)) byActivity.set(overlap.laterActivityId, overlap);
      }
    }
    return byActivity;
  }, [trip]);

  // Both halves of every undismissed overlap, each with the titles it
  // overlaps. `overlapsByActivity` above is the dismissable half — the later
  // stop, one warning each; the river marks BOTH blocks (SPEC §36.9b: "side
  // by side in half-width lanes with a warning outline and OVERLAP"), and a
  // screen reader hears who each one runs into.
  const { overlapPartners, drawnOverlapIds } = useMemo(() => {
    const partners = new Map<string, string[]>();
    const drawn = new Set<string>();
    const add = (id: string, title: string) => partners.set(id, [...(partners.get(id) ?? []), title]);
    for (const day of trip.days) {
      for (const overlap of overlapsForDay(trip, day.dayId)) {
        const later = trip.activities[overlap.laterActivityId];
        add(overlap.laterActivityId, overlap.otherTitle);
        if (later) add(overlap.otherActivityId, later.title);
        drawn.add(overlap.conflictId);
      }
    }
    return { overlapPartners: partners, drawnOverlapIds: drawn };
  }, [trip]);

  // **One axis for the whole trip** (SPEC §36.9b): every column is drawn on
  // it, so a 09:00 stop on Day 1 and on Day 5 sit at the same height. Taken
  // over the scheduled days only — an unscheduled stop is not on any river.
  const axis = useMemo(
    () => riverAxis(trip.days.flatMap((day) => day.activityIds.map((id) => trip.activities[id]?.timeWindow ?? null))),
    [trip],
  );

  // Badge-worthy conflict subjects: a `time-overlap` the board actually draws
  // gets that instead of a bare triangle (the rule is shared through
  // overlapData so no two surfaces disagree on it; only the "what this surface
  // renders" input differs).
  //
  // **Every undismissed overlap is drawn now** (M29 part 2). KI-29's triangle
  // existed because a card had room for ONE overlap chip, so a stop's second
  // overlap had no day-column surface at all. On the river both halves of
  // every pair are marked OVERLAP, sit side by side, and name every stop they
  // run into — so the triangle is left to the conflicts nothing else shows.
  // A phone draws the same river (M29 phone), so the same set holds there.
  const conflictIds = useMemo(() => badgeableConflictSubjects(trip, drawnOverlapIds), [trip, drawnOverlapIds]);

  // Same per-day city derivation Task 8's DayChips / Task 10's TimelineLens
  // use (chipModel → dayAccents), so a day's column tint here always agrees
  // with its chip and its Timeline-view header color.
  const days = useMemo(() => chipModel(trip), [trip]);

  // One dayAccents() call over the whole trip's cities, so collisions between
  // two days of this trip get probed against each other — not per-day calls,
  // which would each only "see" a single city and could never collide.
  const accents = useMemo(() => dayAccents(days.map((d) => d.city)), [days]);

  /**
   * Every day of the trip as the Keep-a-day picker needs it (M23 link 4).
   *
   * One pass over the trip, shared by every pennant — the alternative was
   * `stopsForDay` per flag, which is N passes over every activity to build N
   * copies of the same list.
   */
  const keepCandidates = useMemo(
    () =>
      trip.days.map((day) => ({
        dayId: day.dayId,
        date: day.date,
        // The same derivation as the day's chip, so the picker's `Day N ·
        // City` (§35.7) never names a different city than the chip above it.
        city: cityFor(day, trip.activities),
        stops: stopsForDay(trip, day.dayId) ?? [],
      })),
    [trip],
  );

  // The monitor reads `trip` and `callbacks` through a ref rather than closing
  // over them, so its effect below can have an empty dependency list and
  // register exactly once for the lifetime of the Board. That is not a
  // micro-optimisation: `callbacks` is a fresh object literal on every render
  // of TripBoardScreen, and the monitor now calls back into that screen's
  // state on drag start (auto-opening the rack). With `[trip, callbacks]`
  // deps, that state change re-renders the parent, produces a new `callbacks`
  // identity, and tears the monitor down and re-registers it *in the middle
  // of the drag* — a monitor registered after `dragstart` never sees the
  // matching `drop`, so the drop is silently lost.
  const latest = useRef({ trip, callbacks });
  useEffect(() => {
    latest.current = { trip, callbacks };
  }, [trip, callbacks]);

  useEffect(() => {
    return combine(
      monitorForElements({
        onDragStart: () => latest.current.callbacks.onDragStart(),
        onDrop: ({ source, location }) => {
          const { trip: currentTrip, callbacks: current } = latest.current;
          // pdnd runs this same path for an Escape-cancelled drag (with no
          // drop targets), so the rack's disclosure is told the drag is over
          // before any routing decision — cancel and drop both re-close a
          // drawer the drag itself opened.
          current.onDragEnd();
          const outcome = resolveDrop(currentTrip, source.data, location.current.dropTargets[0]?.data);
          if (outcome === null) return;
          if (outcome.kind === "unschedule") {
            current.onUnschedule(outcome.activityId);
            return;
          }
          if (outcome.kind === "place") {
            current.onPlace(outcome);
            return;
          }
          current.onMove(outcome.activityId, outcome.toDayId, outcome.position);
        },
      }),
      // Root cause of the Task-11-era drag-and-drop regression: nothing here
      // is actually about Board/Column/ActivityCard's own restyle — it's that
      // the cumulative height of everything above the day-columns row (Task
      // 9's taller sticky header, Task 8's day-chips row, etc.) now commonly
      // pushes later day columns below the fold on an ordinary viewport,
      // confirmed by comparing this page's layout against pre-M10 `main`
      // (there, the same 3-day/2-backlog-item trip fit inside a 720px-tall
      // viewport with zero page overflow; here it overflows by ~145px). A
      // day column that starts beneath the visible viewport was never a
      // valid pragmatic-drag-and-drop drop target — `location.current
      // .dropTargets` comes up empty because the browser's own hit-testing
      // has nothing to find at an off-screen point — so no restyle-local
      // tweak to Board/Column/ActivityCard fixes this; the page needs to be
      // able to scroll during a drag, same as it already can with the mouse
      // when not dragging. `autoScrollWindowForElements` is the
      // pragmatic-drag-and-drop project's own answer to exactly this shape
      // of gap (a drop target outside the current scroll position): it
      // scrolls the window as the pointer nears the viewport edge while
      // dragging, letting a real drag reach a day column that content growth
      // pushed out of view instead of requiring the page to already fit.
      //
      // That was the intent; it could not have worked before 2026-09-25
      // (inferred from the mechanism, not separately tested). For as far
      // back as this repo's history goes, the lockfile held two copies of
      // the pdnd core (web on 2.x, auto-scroll on 3.x), so this listened on
      // an adapter the cards never registered with and never saw a drag
      // (KI-2026-09-25-g). What actually got e2e drags to off-screen days
      // was `dragCardTo` scrolling the target into view itself (KI-21).
      // `scripts/check-singletons.mjs` in `pnpm lint` now fails if a second
      // copy of the core comes back.
      autoScrollWindowForElements(),
    );
  }, []);

  // **The river's gestures** (M29 part 3; SPEC §36.9b). A read-only board
  // passes none, and its rivers then offer none — the same "absent, not
  // disabled" rule every other write affordance here follows (ADR-031).
  //
  // Double-click and sketch open the add sheet this column's "+ Add a stop"
  // opens, with the window prefilled; a resize is a plain UpdateActivity of
  // the window; a drop at a time comes back through the monitor above as a
  // `place` outcome. "Now ends at …" is the design's own flash for a resize.
  const clock = useTimeFormat();
  const [notice, setNotice] = useState<string | null>(null);
  const gesturesFor = (dayId: string): RiverGestures | undefined =>
    readOnly
      ? undefined
      : {
          onCreateAt: (timeWindow) => openCreate({ dayId, timeWindow }),
          onResize: (activityId, timeWindow) => {
            latest.current.callbacks.onRetime(activityId, timeWindow);
            setNotice(`Now ends at ${toClockLabel(timeWindow.end, clock)}`);
          },
          // Read at drag time, not render time: the rack changes under a drag.
          canPlace: (activityId) => !latest.current.trip.backlog.includes(activityId),
          // A touch lift is no native drag, so the monitor above never sees
          // it. Routed through the same `resolveDrop` with the same target
          // data the river's drop target carries, so a finger's drop and a
          // mouse's land a stop by the one rule.
          onDropAt: (activityId, toDayId, riverWindow) => {
            const outcome = resolveDrop(latest.current.trip, { activityId }, { dayId: toDayId, riverWindow });
            if (outcome?.kind === "place") latest.current.callbacks.onPlace(outcome);
          },
        };

  return (
    // pt-3 matches the gap-3 rhythm below (ConflictBanner <-> the columns
    // row), so the columns get the same top clearance from the chrome above
    // that they'd get from a banner row that renders — ConflictBanner
    // returns null when there's nothing to show, so without this the
    // columns sat flush against the header (same gap TimelineLens's rows
    // needed above their own first row).
    <div className="flex flex-col gap-3 pt-3">
      <ConflictBanner
        conflicts={trip.conflicts}
        dismissedConflictIds={trip.dismissedConflictIds}
        activities={trip.activities}
        onDismiss={callbacks.onDismissConflict}
        onSelectActivity={readOnly ? undefined : openEdit}
        readOnly={readOnly}
      />
      {/* The unscheduled pool is no longer a full-width Backlog column above
          the grid — it is the Unscheduled drawer (UnscheduledRack), mounted
          by TripBoardScreen outside the lens switch. Creating an unscheduled
          stop lives on the header's "Add stop" (TripHeader), which is the
          same openCreate() with no dayId this column's button used to be. */}
      {/* Handoff README §"Day columns view": horizontally scrolling 268px
          columns rather than wrapping into rows. Adjacency for drag is
          dayId-based, not DOM order, so the switch from wrap to scroll
          doesn't affect drop logic. */}
      {/* The clearance the focused column's ring needs, and the fourth report
          of this same bug: `overflow-x-auto` sets overflow-x to a non-`visible`
          value, and the CSS overflow spec forces the paired overflow-y to
          compute as `auto` too, so the container clips on every side and not
          just the axis meant to scroll. `pb-1` was already here; the ring added
          in a168835 then landed against a flush top and left edge, so the
          FIRST column lost the top and left of its ring against the scroll
          origin (Mitchell, PR #55: "Left side border and top is cut off here"
          / "Border is cut off here").
          `-mx-1` with the `px-1` so the row keeps the header's own gutter
          rather than indenting from it — same pairing as DayChips and
          ui/sheet.tsx, which needed it for exactly this. */}
      {/* A plain block wrapper, so the bar below is the row's immediate
          neighbour (no `gap-3` between them) and its `sticky` is bounded by
          the row: it pins to the viewport bottom only while the row is on
          screen. */}
      <div>
        <div
          ref={scrollRef}
          // A scrollable region is focusable so it can be scrolled from the
          // keyboard at all; that is also what gives the arrow keys below a
          // resting place before anything inside has been tabbed to.
          tabIndex={0}
          role="group"
          aria-label="Day columns"
          onScroll={onRowScroll}
          onKeyDown={onKeyDown}
          // **A column on a phone, a scrolling row on a desktop** (link 13).
          // With one full-width day there is nothing to scroll sideways, and the
          // trailing "One more day?" belongs below the day rather than beside it.
          //
          // **A grid on the desktop, not a flex row** (M29 part 2): each day
          // column is a four-row subgrid of it (`.day-columns-row` in
          // globals.css), which is what holds every river's top edge at one
          // height when the shelves above them differ. `auto-cols-max` keeps
          // each column at its own 268px, so the row still overflows and
          // scrolls rather than squashing (design-system.md, "Horizontal
          // scrollers").
          className={cn(
            "-mx-1 gap-3 px-1 pt-1 pb-1",
            oneDay ? "flex flex-col" : "day-columns-row grid auto-cols-max grid-flow-col gap-y-2 overflow-x-auto",
          )}
        >
          {/* **One day on a phone, every day on a desktop** (M26 link 13). The
              index is preserved through the filter, not re-derived: every day's
              accent, its `dayLabel`, its focus ring and its keep-a-day pennant
              are all keyed on the day's real position in the trip, and a
              re-indexed single day would silently become Day 1 of a fortnight.

              `focusedDay ?? 0` matches the phone's own default — `TripBoardScreen`
              already focuses day 1 on a phone, so this only ever falls back on a
              frame before that landed. */}
          {(oneDay
            ? trip.days
                .map((day, index) => [day, index] as const)
                .filter(([, index]) => index === (focusedDay ?? 0))
            : trip.days.map((day, index) => [day, index] as const)
          ).map(([day, index]) => (
            <Column
              key={day.dayId}
              fullWidth={oneDay}
              title={dayLabel(trip.startDate, index)}
              dayId={day.dayId}
              activityIds={day.activityIds}
              activities={trip.activities}
              conflictIds={conflictIds}
              overlaps={overlapsByActivity}
              overlapPartners={overlapPartners}
              axis={axis}
              currency={trip.currency}
              accent={accents[index]?.tint ?? "neutral"}
              onEditActivity={openEdit}
              onRemoveActivity={callbacks.onRemoveActivity}
              // Both are optional on Column, which already treats "not given"
              // as "do not render the control" — so a read-only board reuses
              // that, rather than teaching Column a second way to be quiet.
              onRemoveDay={readOnly ? undefined : () => callbacks.onRemoveDay(day.dayId)}
              isFocused={focusedDay === index}
              onSelect={(clear) => callbacks.onSelectDay(clear ? null : index)}
              columnRef={columnRefSetters[index]}
              onAddActivity={readOnly ? undefined : () => openCreate({ dayId: day.dayId })}
              gestures={gesturesFor(day.dayId)}
              onDismissOverlap={callbacks.onDismissConflict}
              focusedTag={focusedTag}
              onToggleTag={onToggleTag}
              readOnly={readOnly}
              // SPEC §24's "keep this day" pennant, which lived in the day
              // header of a lens this milestone DELETED. Timeline going was the
              // handoff's own instruction ("deleted, not hidden ... do not port
              // it"), but the pennant was not Timeline's — §24 still calls it
              // "one entry point: a flag pill in the desktop day header", and
              // Plan is the desktop day header now. It went out with the lens
              // and left `KeepDayFlag` imported by nothing but its own test:
              // the control, its dialog, its celebration and its whole server
              // route, all still built, all unreachable. `m11-saved-days` is
              // what said so, by waiting 90 seconds for a button nothing
              // rendered.
              //
              // The stops come from the trip's own rows, so what gets kept is
              // exactly what is drawn above them — the same reading TimelineLens
              // did, and the reason this is a `Board` concern rather than a
              // `Column` one: `stopsForDay` needs the whole `TripDetail`.
              //
              // **Every day travels, not just this one** (M23 link 4). The
              // pennant is still about the day it sits on, and the dialog opens
              // with that day selected — but its picker offers the whole trip, so
              // a Playbook can span several days that need not be adjacent. Built
              // once above the loop rather than per flag: it is the same list for
              // every day, and rebuilding it N times would be N passes over every
              // activity in the trip.
              keepFlag={
                readOnly ? undefined : (
                  <KeepDayFlag
                    dayIndex={index}
                    accent={accents[index]?.ink ?? "neutral"}
                    tripId={trip.tripId}
                    dayId={day.dayId}
                    tripName={trip.name}
                    days={keepCandidates}
                  />
                )
              }
            />
          ))}
          {/* "One more day?" is an invitation to change the trip, so it is the
              reader's cue that they are looking at somebody else's — or, on the
              demo, at one that is not theirs yet.

              **On a phone it appears only at the END of the trip** (M26 link 13).
              With one day on screen it is no longer a column beyond the last one;
              it would sit under Day 3 of a fortnight saying "one more day?",
              which is a question about somewhere the reader is not. Focusing the
              last day is what puts them at the end, and that is where the
              invitation belongs. */}
          {!readOnly && (!oneDay || (focusedDay ?? 0) === trip.days.length - 1) && (
            <OneMoreDayColumn onAddDay={callbacks.onAddDay} addSavedDay={addSavedDay} fullWidth={oneDay} />
          )}
        </div>
        {/* The row's stand-in scrollbar (see `onRowScroll`). Desktop only: the
            phone's one-day board does not scroll sideways. Hidden from the
            accessibility tree and the tab order because it duplicates the row,
            which is already focusable and arrow-key driven. */}
        {!oneDay && (
          <div
            ref={barRef}
            data-testid="board-columns-scrollbar"
            aria-hidden
            tabIndex={-1}
            onScroll={onBarScroll}
            className="day-columns-scrollbar -mx-1 overflow-x-auto overflow-y-hidden"
          >
            <div ref={barSpacerRef} className="h-px" />
          </div>
        )}
      </div>
      {notice !== null && <Toast message={notice} onDismiss={() => setNotice(null)} />}
    </div>
  );
}
