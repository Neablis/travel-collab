"use client";

import type { ActivityView } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { ActivityEditor, type ActivityDayOption, type ActivityFormValue } from "@/components/board/ActivityEditor";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useTrip } from "@/components/trip/context/TripProvider";
import { dayLabel } from "@/lib/dates";

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
  const { activeTrip, dispatch } = useTrip();

  const open = state.mode !== null;
  const title = state.mode === "edit" ? "Edit activity" : "Add a stop";

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
        cost: value.cost ?? undefined,
      });
    }
    close();
  }

  return (
    <Sheet title={title} open={open} onOpenChange={(next) => { if (!next) close(); }}>
      {open && (
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
