"use client";

import { useEffect, useMemo, useRef } from "react";
import { combine } from "@atlaskit/pragmatic-drag-and-drop/combine";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { autoScrollWindowForElements } from "@atlaskit/pragmatic-drag-and-drop-auto-scroll/element";
import type { TripDetail } from "@tc/contracts";
import { dayLabel } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { useEditor } from "@/components/trip/context/EditorHost";
import { chipModel } from "@/components/trip/DayChips";
import { badgeableConflictSubjects, overlapsForDay, type Overlap } from "@/components/lenses/overlapData";
import { dayAccentFor } from "@/lib/dayAccent";
import { Preview } from "@/components/ui/preview";
import { type ActivityFormValue } from "./ActivityEditor";
import { Column, DAY_COLUMN_WIDTH_PX } from "./Column";
import { ConflictBanner } from "./ConflictBanner";
import { resolveDrop } from "./resolveDrop";

// Phase 6, Step 3 item 5: the trailing "One more day?" column, which replaces
// the loose "+ Add day" button that used to trail the row. Shaped like a day
// column (same 268px, dashed instead of tinted) so it reads as "the trip could
// grow by one more of these" rather than as a stray control parked next to the
// plan — the Day-columns twin of the timeline's EndOfTrip block, carrying the
// same two actions: a real "Add a day" (the AddDay command TripBoardScreen
// already dispatches) and, inside <Preview id="insert-playbook">, M11's inert
// "Add a saved day".
//
// Deliberately NOT importing trip/EndOfTrip.tsx or extracting a shared block
// out of it. The two share their copy and their actions, not their layout:
// EndOfTrip is a full-bleed horizontal section (heading + a sentence of body
// copy, the button floated opposite it, three Playbook shortcut cards in a
// 3-up grid), and this is a 268px vertical column with no body copy and no
// room for the shortcut grid. A shared component would be a prop-toggled
// union of two different shapes; two buttons is the smaller duplication.
//
// Design values from the phase file's "Design values" note: 15px/600
// --color-ink title, dashed, matching the day columns' 268px width. The
// design's own trailing column (`Trip Planner Redesign.dc.html:630-650`)
// additionally carries a "Saved days keep their order and gaps" line and the
// three end-of-trip Playbook shortcuts; neither is in this phase's copy table,
// so neither is invented here.
function OneMoreDayColumn({ onAddDay }: { onAddDay: () => void }) {
  return (
    <section
      data-testid="one-more-day-column"
      className="flex shrink-0 flex-col gap-2.5 rounded-2xl border border-dashed border-border-strong p-3.5"
      // eslint-disable-next-line no-restricted-syntax -- 268px matches the day columns' width, which has no token equivalent (Column.tsx carries the same escape hatch and owns the constant)
      style={{ width: DAY_COLUMN_WIDTH_PX }}
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
      {/* size="container": a region rather than a single control, so the
          dotted border and the "Preview · M11" chip — same treatment
          EndOfTrip gives its own copy of this button. The shield inside
          Preview swallows every click below it, so this button neither has
          nor needs an onClick. */}
      <Preview id="insert-playbook" size="container" className="p-2">
        <Button variant="secondary" className="w-full justify-center">
          Add a saved day
        </Button>
      </Preview>
    </section>
  );
}

export type BoardCallbacks = {
  onMove: (activityId: string, toDayId: string | null, position: number) => void;
  /** A drop on the unscheduled rack: off the schedule, times stripped. */
  onUnschedule: (activityId: string) => void;
  /** Raised for every drag, so the rack's disclosure reducer can auto-open. */
  onDragStart: () => void;
  /** Raised on drop *and* on an Escape-cancelled drag — pdnd runs the same path. */
  onDragEnd: () => void;
  onAddDay: () => void;
  onRemoveDay: (dayId: string) => void;
  onAddActivity: (value: ActivityFormValue) => void;
  onUpdateActivity: (activityId: string, value: ActivityFormValue) => void;
  onRemoveActivity: (activityId: string) => void;
  onDismissConflict: (conflictId: string) => void;
};

export function Board({ trip, callbacks }: { trip: TripDetail; callbacks: BoardCallbacks }) {
  const { openCreate, openEdit } = useEditor();

  // Badge-worthy conflict subjects only: a `time-overlap` gets the compact
  // chip below instead of a bare triangle, and the exclusion rule is shared
  // with TimelineLens (overlapData) so the two lenses cannot disagree.
  const conflictIds = useMemo(
    () => badgeableConflictSubjects(trip.conflicts),
    [trip.conflicts],
  );

  // Every day's live time-overlaps, flattened to one lookup keyed by the stop
  // the warning attaches to. A stop can be the later half of more than one
  // crossing pair; a column card has room for exactly one chip, so the first
  // wins (the timeline, which has the room, shows them all).
  const overlapsByActivity = useMemo(() => {
    const byActivity = new Map<string, Overlap>();
    for (const day of trip.days) {
      for (const overlap of overlapsForDay(trip, day.dayId)) {
        if (!byActivity.has(overlap.laterActivityId)) byActivity.set(overlap.laterActivityId, overlap);
      }
    }
    return byActivity;
  }, [trip]);

  // Same per-day city derivation Task 8's DayChips / Task 10's TimelineLens
  // use (chipModel → dayAccentFor), so a day's column tint here always agrees
  // with its chip and its Timeline-view header color.
  const days = useMemo(() => chipModel(trip), [trip]);

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
      autoScrollWindowForElements(),
    );
  }, []);

  return (
    <div className="flex flex-col gap-3">
      <ConflictBanner
        conflicts={trip.conflicts}
        dismissedConflictIds={trip.dismissedConflictIds}
        onDismiss={callbacks.onDismissConflict}
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
      <div className="flex gap-3 overflow-x-auto pb-1">
        {trip.days.map((day, index) => (
          <Column
            key={day.dayId}
            title={dayLabel(trip.startDate, index)}
            dayId={day.dayId}
            activityIds={day.activityIds}
            activities={trip.activities}
            conflictIds={conflictIds}
            overlaps={overlapsByActivity}
            currency={trip.currency}
            accent={dayAccentFor(days[index]?.city ?? null).tint}
            onEditActivity={openEdit}
            onRemoveActivity={callbacks.onRemoveActivity}
            onRemoveDay={() => callbacks.onRemoveDay(day.dayId)}
            onAddActivity={() => openCreate({ dayId: day.dayId })}
            onDismissOverlap={callbacks.onDismissConflict}
          />
        ))}
        <OneMoreDayColumn onAddDay={callbacks.onAddDay} />
      </div>
    </div>
  );
}
