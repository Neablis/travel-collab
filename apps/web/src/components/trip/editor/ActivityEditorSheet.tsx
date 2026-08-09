"use client";

import type { ActivityView } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { DataText } from "@/components/ui/data-text";
import { ActivityEditor, type ActivityFormValue } from "@/components/board/ActivityEditor";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useTrip } from "@/components/trip/context/TripProvider";
import { formatTripDate } from "@/lib/formatDate";

// Behavior change #2 (M5 wave 2, resolves PR #11 comment #9): the activity
// editor is now a portable Sheet raised from EditorHost's own state, not
// rendered inline wherever a lens happens to trigger it. ActivityEditor's
// form markup/behavior is unchanged — this is only a new host surface.
export function ActivityEditorSheet() {
  const { state, close } = useEditor();
  const { activeTrip, dispatch } = useTrip();

  const open = state.mode !== null;
  const title = state.mode === "edit" ? "Edit activity" : "New activity";

  const editingActivity: ActivityView | null =
    state.mode === "edit" && state.activityId !== undefined
      ? (activeTrip?.activities[state.activityId] ?? null)
      : null;

  // Seed a synthetic "initial" from the create-mode prefill so ActivityEditor's
  // existing initial-value mapping (ActivityView shape) can be reused unchanged.
  const createInitial: ActivityView | null =
    state.mode === "create" && state.prefill !== undefined
      ? {
          activityId: "",
          title: "",
          timeWindow: state.prefill.timeWindow ?? null,
          location: state.prefill.location ?? null,
          notes: null,
          anchors: [],
          cost: null,
        }
      : null;

  // Handoff dialog spec's "day" + "slot-availability" note: this is purely
  // informational display, computed from data ActivityEditorSheet already
  // has in scope (activeTrip.days) — it adds no new prop to ActivityEditor
  // and doesn't touch the onSave/onCancel wiring. Create mode gets its dayId
  // straight from the openCreate() prefill (e.g. TimelineLens's "Add stop");
  // edit mode looks up which day already lists this activityId. Either can
  // come back with no match (a MapLens create-by-coordinate has no dayId; a
  // backlog activity belongs to no day) — the note is simply omitted rather
  // than guessed.
  const editingActivityId = state.mode === "edit" ? state.activityId : undefined;
  const dayId =
    state.mode === "create"
      ? state.prefill?.dayId
      : editingActivityId !== undefined
        ? activeTrip?.days.find((d) => d.activityIds.includes(editingActivityId))?.dayId
        : undefined;
  const dayIndex = dayId !== undefined ? (activeTrip?.days.findIndex((d) => d.dayId === dayId) ?? -1) : -1;
  const day = dayIndex >= 0 ? activeTrip?.days[dayIndex] : undefined;
  // "Other" stops already on the day, excluding the activity being edited.
  const otherStopCount = day ? day.activityIds.filter((id) => id !== editingActivityId).length : 0;

  function handleSave(value: ActivityFormValue) {
    if (activeTrip === null) return;
    if (state.mode === "edit" && state.activityId !== undefined) {
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
        dayId: state.prefill?.dayId,
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
        <div className="flex flex-col gap-3">
          {day && (
            <div data-testid="activity-editor-day-note" className="rounded-md bg-paper px-3 py-2">
              <DataText size="sm" className="block text-ink">
                Day {dayIndex + 1}
                {day.date ? ` · ${formatTripDate(day.date)}` : ""}
              </DataText>
              <DataText size="xs" className="mt-0.5 block">
                {otherStopCount === 0
                  ? "No other stops yet — this'll be the first."
                  : `${otherStopCount} other stop${otherStopCount === 1 ? "" : "s"} already on this day.`}
              </DataText>
            </div>
          )}
          <ActivityEditor
            key={state.mode === "edit" ? state.activityId : "create"}
            initial={state.mode === "edit" ? editingActivity : createInitial}
            tripCurrency={activeTrip?.currency ?? "USD"}
            onSave={handleSave}
            onCancel={close}
          />
        </div>
      )}
    </Sheet>
  );
}
