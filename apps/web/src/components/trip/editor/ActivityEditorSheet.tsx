"use client";

import type { ActivityView } from "@tc/contracts";
import { Sheet } from "@/components/ui/sheet";
import { ActivityEditor, type ActivityFormValue } from "@/components/board/ActivityEditor";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useTrip } from "@/components/trip/context/TripProvider";

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
        <ActivityEditor
          key={state.mode === "edit" ? state.activityId : "create"}
          initial={state.mode === "edit" ? editingActivity : createInitial}
          tripCurrency={activeTrip?.currency ?? "USD"}
          onSave={handleSave}
          onCancel={close}
        />
      )}
    </Sheet>
  );
}
