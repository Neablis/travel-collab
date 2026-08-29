"use client";

import type { ActivityView } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { DataText } from "@/components/ui/data-text";
import { Text } from "@/components/ui/text";
import { ActivityEditor, type ActivityDayOption, type ActivityFormValue } from "@/components/board/ActivityEditor";
import { ActivityConflicts } from "@/components/trip/editor/ActivityConflicts";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useTrip } from "@/components/trip/context/TripProvider";
import { dayLabel } from "@/lib/dates";
import { toClockRange } from "@/lib/time";
import { formatMoney } from "@/components/lenses/formatMoney";

// Behavior change #2 (M5 wave 2, resolves PR #11 comment #9): the activity
// editor is now a portable Sheet raised from EditorHost's own state, not
// rendered inline wherever a lens happens to trigger it. ActivityEditor's
// form markup/behavior is unchanged — this is only a new host surface.
//
// Redesign (Phase 7, Task 7.1): the "day note" block this used to render as a
// static paper sidecar is gone — its job (the day + slot-availability note)
// is now the design's real `Banner variant="success"`, computed live from
// Day/Start inside ActivityEditor itself (via fitIntoDay), not a one-shot
// value handed down here. This component's remaining job is just building
// the per-day option list (label + already-scheduled windows) that Banner
// needs, and wiring dayId correctly into AddActivity/UpdateActivity.
export function ActivityEditorSheet() {
  const { state, close } = useEditor();
  const { activeTrip, dispatch, readOnly } = useTrip();

  const open = state.mode !== null;
  // A viewer never gets the form. This is the backstop for every caller of
  // `openEdit` the board surface does not own — MapLens, TimelineLens and
  // CalendarLens all raise the sheet, and all three are outside this change's
  // scope — so the sheet presents read-only regardless of which one opened it
  // (docs/reviews/2026-08-28-m11-pr71-review.md §5). The title changes with
  // it: "Edit activity" over a form nothing can save is a promise the sheet
  // does not keep. NOT the security boundary — the server refuses a viewer's
  // UpdateActivity/AddActivity independently, and TripProvider's own dispatch
  // gate refuses them before they reach the network.
  const title = readOnly ? "Activity" : state.mode === "edit" ? "Edit activity" : "Add a stop";

  const editingActivity: ActivityView | null =
    state.mode === "edit" && state.activityId !== undefined
      ? (activeTrip?.activities[state.activityId] ?? null)
      : null;

  // Seed a synthetic "initial" from the create-mode prefill so ActivityEditor's
  // existing initial-value mapping (ActivityView shape) can be reused unchanged.
  // Its timeWindow (e.g. TimelineLens's nextSlot) is also what ActivityEditor
  // reverse-maps into an initial "How long" selection (closestDurationLabel).
  const createInitial: ActivityView | null =
    state.mode === "create" && state.prefill !== undefined
      ? {
          activityId: "",
          title: "",
          timeWindow: state.prefill.timeWindow ?? null,
          location: state.prefill.location ?? null,
          notes: null,
          anchors: [],
          kind: "planned" as const,
          tags: [],
          cost: null,
        }
      : null;

  // Create mode gets its dayId straight from the openCreate() prefill (e.g.
  // TimelineLens's "Add stop"); edit mode looks up which day already lists
  // this activityId. Either can come back with no match (a MapLens
  // create-by-coordinate has no dayId; a backlog activity belongs to no
  // day) — ActivityEditor's own default-day effect handles that (falls back
  // to the first day in create mode, stays unselected in edit mode) rather
  // than this component guessing one.
  const editingActivityId = state.mode === "edit" ? state.activityId : undefined;
  const defaultDayId =
    state.mode === "create"
      ? state.prefill?.dayId
      : editingActivityId !== undefined
        ? activeTrip?.days.find((d) => d.activityIds.includes(editingActivityId))?.dayId
        : undefined;

  const dayOptions: ActivityDayOption[] =
    activeTrip?.days.map((day, index) => ({
      dayId: day.dayId,
      label: dayLabel(activeTrip.startDate, index),
      // Other stops already on this day, excluding whichever activity is
      // being edited — same existing:Slot[] shape TripBoardScreen's
      // assignFromRack builds for fitIntoDay.
      existing: day.activityIds
        .filter((id) => id !== editingActivityId)
        .map((id) => activeTrip.activities[id]?.timeWindow)
        .filter((w): w is { start: string; end: string } => w !== null && w !== undefined),
    })) ?? [];

  function handleSave(value: ActivityFormValue) {
    if (activeTrip === null) return;
    // Unreachable while the form is not rendered for a viewer; kept so the
    // gate does not depend on the render branch above staying correct.
    if (readOnly) return;
    if (state.mode === "edit" && state.activityId !== undefined) {
      // UpdateActivity carries no dayId (ActivityEditor's Day select is
      // disabled in edit mode for exactly this reason) — cross-day moves
      // stay MoveActivity's job (drag-and-drop), not this form's.
      void dispatch({
        type: "UpdateActivity",
        tripId: activeTrip.tripId,
        activityId: state.activityId,
        title: value.title,
        timeWindow: value.timeWindow,
        location: value.location,
        notes: value.notes,
        anchors: value.anchors,
        // M18. Both branches here hand-enumerate the form's fields, so a new
        // one is dropped silently — TypeScript does not flag the extra
        // property on `value`, and the sheet's own tests kept passing while
        // the user's kind and tags went nowhere. This is the third time this
        // milestone has hit that shape: PR 1 hit it in equality/diff/hydrate/
        // detail, and the project review found it again in Location.city
        // (KI-54). §6.1's activity-field descriptor refactor is the standing
        // fix; until it lands, adding a field means grepping for every
        // enumeration of them.
        kind: value.kind,
        tags: value.tags,
        cost: value.cost,
      });
    } else if (state.mode === "create") {
      void dispatch({
        type: "AddActivity",
        tripId: activeTrip.tripId,
        activityId: crypto.randomUUID(),
        // The form's own Day select wins over the prefill once the user has
        // touched it — value.dayId already falls back to the prefill/first
        // day via ActivityEditor's default-day effect, so this is just
        // forwarding its answer, not re-deriving one.
        dayId: value.dayId ?? undefined,
        title: value.title,
        timeWindow: value.timeWindow ?? undefined,
        location: value.location ?? undefined,
        notes: value.notes ?? undefined,
        anchors: value.anchors,
        // See the UpdateActivity branch above — same enumeration, same trap.
        kind: value.kind,
        tags: value.tags,
        cost: value.cost ?? undefined,
      });
    }
    close();
  }

  return (
    <Sheet title={title} open={open} onOpenChange={(next) => { if (!next) close(); }}>
      {open && editingActivityId !== undefined && activeTrip !== null && (
        // KI-43: every conflict naming this stop, dismissed ones included.
        // Edit mode only — a stop being created has no id yet, so nothing can
        // name it, and the domain has not run a rule against it either.
        <ActivityConflicts
          conflicts={activeTrip.conflicts}
          dismissedConflictIds={activeTrip.dismissedConflictIds}
          activityId={editingActivityId}
        />
      )}
      {open && readOnly && (
        <ReadOnlyActivity
          activity={editingActivity}
          currency={activeTrip?.currency ?? "USD"}
          onClose={close}
        />
      )}
      {open && !readOnly && (
        <ActivityEditor
          // Edit mode's key includes whether the real activity has loaded
          // yet, not just its id — activeTrip is null only during a trip's
          // very first fetch (TripProvider never nulls it out again once
          // loaded), and nothing today can trigger openEdit before that
          // fetch resolves (every caller only renders a clickable activity
          // once activeTrip itself is non-null). Still worth guarding: if
          // that ever changes (e.g. a future deep-link opens edit mode on
          // load), a null `initial` would otherwise seed ActivityEditor's
          // fields blank once and never re-seed when the real data arrives
          // a moment later, since React reuses the instance across
          // re-renders with the same key — a save would then silently
          // overwrite real fields with blanks (CodeRabbit, PR #32).
          key={state.mode === "edit" ? `${state.activityId}-${editingActivity ? "loaded" : "pending"}` : "create"}
          mode={state.mode === "edit" ? "edit" : "create"}
          initial={state.mode === "edit" ? editingActivity : createInitial}
          days={dayOptions}
          defaultDayId={defaultDayId}
          tripCurrency={activeTrip?.currency ?? "USD"}
          onSave={handleSave}
          onCancel={close}
        />
      )}
    </Sheet>
  );
}

// A viewer's presentation of the sheet: what the stop actually is, with no
// control that would dispatch. It exists because the notes field has no other
// surface in the app — dropping the sheet entirely for a viewer would hide
// real content, not just an affordance.
function ReadOnlyActivity({
  activity,
  currency,
  onClose,
}: {
  activity: ActivityView | null;
  currency: string;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {activity === null ? (
        <Text as="p" variant="secondary">
          You have view-only access to this trip.
        </Text>
      ) : (
        <>
          <Text as="p" className="font-medium">{activity.title}</Text>
          <DataText size="xs" className="block">
            {activity.timeWindow === null
              ? "No time yet"
              : toClockRange(activity.timeWindow.start, activity.timeWindow.end)}
          </DataText>
          {activity.location && (
            <Text as="p" variant="secondary">{activity.location.name}</Text>
          )}
          <DataText size="xs" className="block">
            {activity.cost === null ? "No cost yet" : formatMoney(activity.cost.amountMinor, currency)}
          </DataText>
          {activity.notes !== null && activity.notes !== "" && (
            <Text as="p" variant="secondary">{activity.notes}</Text>
          )}
          <Text as="p" variant="secondary">You have view-only access to this trip.</Text>
        </>
      )}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={onClose}>Close</Button>
      </div>
    </div>
  );
}
