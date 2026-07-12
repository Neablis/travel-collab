"use client";

import { useState } from "react";
import Link from "next/link";
import { useTrip } from "@/components/trip/context/TripProvider";
import { LENSES, useLens } from "@/components/trip/context/LensRouter";
import { CalendarLens } from "@/components/lenses/CalendarLens";
import { MapLens } from "@/components/lenses/MapLens";
import { TimelineLens } from "@/components/lenses/TimelineLens";
import { TripDateControl } from "@/components/lenses/TripDateControl";
import { ItineraryLens } from "@/components/lenses/ItineraryLens";
import { DailyOverviewLens } from "@/components/lenses/DailyOverviewLens";
import { FullTripOverviewLens } from "@/components/lenses/FullTripOverviewLens";
import { Heading } from "@/components/ui/heading";
import { TabStrip } from "@/components/ui/tab-strip";
import { ActivityEditor, type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";
import { HistoryPanel } from "./HistoryPanel";
import { TripMoneySettings } from "./TripMoneySettings";
import { UndoRedoControls } from "./UndoRedoControls";

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const { trip, history, activeTrip, status, error, pending, dispatch, preview } = useTrip();
  const { lens, setLens } = useLens();
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);

  // The page shell (trips/[tripId]/page.tsx) now owns the <main> landmark via
  // PageContainer as="main" — this component renders its fragment inside it.
  if (status === "loading") return <>Loading…</>;
  if (status === "unauthenticated") {
    return (
      <>
        <Heading level={1}>travel-collab</Heading>
        <Link href={`/api/auth/signin?callbackUrl=/trips/${tripId}`}>Sign in</Link>
      </>
    );
  }
  if (status === "error" || trip === null || activeTrip === null) {
    return (
      <>
        <p role="alert">{error ?? "Something went wrong"}</p>
        <Link href="/">← Your trips</Link>
      </>
    );
  }

  const editingActivity = editingActivityId !== null ? (activeTrip.activities[editingActivityId] ?? null) : null;

  const updateActivity = (activityId: string, value: ActivityFormValue) =>
    void dispatch({
      type: "UpdateActivity",
      tripId,
      activityId,
      title: value.title,
      timeWindow: value.timeWindow,
      location: value.location,
      notes: value.notes,
      anchors: value.anchors,
      cost: value.cost,
    });

  return (
    <>
      <nav>
        <Link href="/">← Your trips</Link>
      </nav>
      <Heading level={2}>{trip.name}</Heading>
      {preview.seq === null && (
        <TripDateControl
          tripId={tripId}
          startDate={trip.startDate}
          onCommand={(command) => {
            if (command.type !== "CreateTrip") void dispatch(command);
          }}
        />
      )}
      {preview.seq === null && (
        <TripMoneySettings
          tripId={tripId}
          currency={trip.currency}
          budget={trip.budget}
          onCommand={(command) => {
            if (command.type !== "CreateTrip") void dispatch(command);
          }}
        />
      )}
      {preview.seq === null && (
        <UndoRedoControls
          canUndo={history?.canUndo ?? false}
          canRedo={history?.canRedo ?? false}
          onUndo={() => void dispatch({ type: "UndoLastChange", tripId })}
          onRedo={() => void dispatch({ type: "RedoChange", tripId })}
          isBusy={pending}
        />
      )}
      <HistoryPanel
        history={history}
        previewSeq={preview.seq}
        onPreview={(seq) => void preview.enter(seq)}
        onExitPreview={preview.exit}
        onRevert={(toSeq) => void dispatch({ type: "RevertToState", tripId, toSeq })}
      />
      {error !== null && <p role="alert">{error}</p>}
      <TabStrip
        value={lens}
        onValueChange={setLens}
        options={LENSES.map((l) => ({ value: l, label: l }))}
        aria-label="Trip view"
      />
      <div inert={preview.seq !== null ? true : undefined}>
        {lens === "Board" && (
          <Board
            trip={activeTrip}
            callbacks={{
              onMove: (activityId, toDayId, position) =>
                void dispatch({ type: "MoveActivity", tripId, activityId, toDayId, position }),
              onAddDay: () => void dispatch({ type: "AddDay", tripId, dayId: crypto.randomUUID() }),
              onRemoveDay: (dayId) => void dispatch({ type: "RemoveDay", tripId, dayId }),
              onAddActivity: (value: ActivityFormValue) =>
                void dispatch({
                  type: "AddActivity",
                  tripId,
                  activityId: crypto.randomUUID(),
                  title: value.title,
                  timeWindow: value.timeWindow ?? undefined,
                  location: value.location ?? undefined,
                  notes: value.notes ?? undefined,
                  anchors: value.anchors,
                  cost: value.cost ?? undefined,
                }),
              onUpdateActivity: updateActivity,
              onRemoveActivity: (activityId) => void dispatch({ type: "RemoveActivity", tripId, activityId }),
              onDismissConflict: (conflictId) => void dispatch({ type: "DismissConflict", tripId, conflictId }),
            }}
          />
        )}
        {lens === "Map" && <MapLens detail={activeTrip} onSelectActivity={setEditingActivityId} />}
        {/* Interim: LensRouter's LENSES already merged Timeline/Calendar into a single
            "Schedule" lens (Task L1 will build the real ScheduleLens with its own
            Timeline/Calendar toggle). Until then, render both existing lens components
            stacked under the Schedule tab so no functionality regresses. */}
        {lens === "Schedule" && (
          <>
            <TimelineLens detail={activeTrip} onSelectActivity={setEditingActivityId} />
            <CalendarLens detail={activeTrip} onSelectActivity={setEditingActivityId} />
          </>
        )}
        {lens === "Itinerary" && <ItineraryLens detail={activeTrip} onSelectActivity={setEditingActivityId} />}
        {lens === "Daily" && <DailyOverviewLens detail={activeTrip} />}
        {lens === "Trip" && <FullTripOverviewLens detail={activeTrip} />}
        {lens !== "Board" && editingActivityId !== null && editingActivity !== null && (
          <div className="mt-3 max-w-md">
            <ActivityEditor
              key={editingActivityId}
              initial={editingActivity}
              tripCurrency={activeTrip.currency}
              onSave={(value) => {
                updateActivity(editingActivityId, value);
                setEditingActivityId(null);
              }}
              onCancel={() => setEditingActivityId(null)}
            />
          </div>
        )}
      </div>
    </>
  );
}
