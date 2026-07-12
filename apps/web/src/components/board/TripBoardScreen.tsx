"use client";

import Link from "next/link";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { LENSES, useLens } from "@/components/trip/context/LensRouter";
import { CalendarLens } from "@/components/lenses/CalendarLens";
import { MapLens } from "@/components/lenses/MapLens";
import { TimelineLens } from "@/components/lenses/TimelineLens";
import { ItineraryLens } from "@/components/lenses/ItineraryLens";
import { DailyOverviewLens } from "@/components/lenses/DailyOverviewLens";
import { FullTripOverviewLens } from "@/components/lenses/FullTripOverviewLens";
import { Heading } from "@/components/ui/heading";
import { TabStrip } from "@/components/ui/tab-strip";
import { TripHeader } from "@/components/trip/TripHeader";
import { ActivityEditorSheet } from "@/components/trip/editor/ActivityEditorSheet";
import { type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const { trip, activeTrip, status, error, dispatch, preview } = useTrip();
  const { lens, setLens } = useLens();
  const { openEdit } = useEditor();

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
      <TripHeader tripId={tripId} />
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
        {lens === "Map" && <MapLens detail={activeTrip} onSelectActivity={openEdit} />}
        {/* Interim: LensRouter's LENSES already merged Timeline/Calendar into a single
            "Schedule" lens (Task L1 will build the real ScheduleLens with its own
            Timeline/Calendar toggle). Until then, render both existing lens components
            stacked under the Schedule tab so no functionality regresses. */}
        {lens === "Schedule" && (
          <>
            <TimelineLens detail={activeTrip} onSelectActivity={openEdit} />
            <CalendarLens detail={activeTrip} onSelectActivity={openEdit} />
          </>
        )}
        {lens === "Itinerary" && <ItineraryLens detail={activeTrip} onSelectActivity={openEdit} />}
        {lens === "Daily" && <DailyOverviewLens detail={activeTrip} />}
        {lens === "Trip" && <FullTripOverviewLens detail={activeTrip} />}
      </div>
      {/* Behavior change #2 (M5 wave 2, resolves #9): the activity editor is a
          portable Sheet raised via EditorHost, mounted once here outside the
          lens switch so it's available regardless of which lens is active. */}
      <ActivityEditorSheet />
    </>
  );
}
