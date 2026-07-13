"use client";

import { useState } from "react";
import Link from "next/link";
import { useTrip } from "@/components/trip/context/TripProvider";
import { LENSES, useLens } from "@/components/trip/context/LensRouter";
import { MapLens } from "@/components/lenses/MapLens";
import { ScheduleLens } from "@/components/lenses/ScheduleLens";
import { ItineraryLens } from "@/components/lenses/ItineraryLens";
import { DailyOverviewLens } from "@/components/lenses/DailyOverviewLens";
import { FullTripOverviewLens } from "@/components/lenses/FullTripOverviewLens";
import { Heading } from "@/components/ui/heading";
import { TabStrip } from "@/components/ui/tab-strip";
import { PageContainer } from "@/components/ui/page-container";
import { TripHeader } from "@/components/trip/TripHeader";
import { ActivityEditor, type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const { trip, activeTrip, status, error, dispatch, preview } = useTrip();
  const { lens, setLens } = useLens();
  const [editingActivityId, setEditingActivityId] = useState<string | null>(null);

  // The page shell (trips/[tripId]/page.tsx) now owns the <main> landmark via
  // PageContainer as="main" width="full" px-0 (Task L1) — this component owns
  // its own horizontal padding via PageContainer wrappers below, so these
  // early-return states need their own too.
  if (status === "loading")
    return (
      <PageContainer width="full">
        Loading…
      </PageContainer>
    );
  if (status === "unauthenticated") {
    return (
      <PageContainer width="full">
        <Heading level={1}>travel-collab</Heading>
        <Link href={`/api/auth/signin?callbackUrl=/trips/${tripId}`}>Sign in</Link>
      </PageContainer>
    );
  }
  if (status === "error" || trip === null || activeTrip === null) {
    return (
      <PageContainer width="full">
        <p role="alert">{error ?? "Something went wrong"}</p>
        <Link href="/">← Your trips</Link>
      </PageContainer>
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

  // Task L1: the page shell (P1) no longer pads its <main> (width="full"
  // px-0) so a non-full lens's own PageContainer width="content" can own
  // horizontal padding without doubling up. Chrome that's shared across all
  // lenses (the tab strip, the error banner) and the full-bleed lenses
  // (Board, Map) get their padding from this PageContainer width="full"
  // wrapper instead.
  const isFullLens = lens === "Board" || lens === "Map";

  return (
    <>
      <TripHeader tripId={tripId} />
      <PageContainer width="full">
        {error !== null && <p role="alert">{error}</p>}
        <TabStrip
          value={lens}
          onValueChange={setLens}
          options={LENSES.map((l) => ({ value: l, label: l }))}
          aria-label="Trip view"
        />
      </PageContainer>
      <div inert={preview.seq !== null ? true : undefined}>
        {isFullLens ? (
          <PageContainer width="full">
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
          </PageContainer>
        ) : (
          <PageContainer width="content">
            {lens === "Schedule" && (
              <ScheduleLens detail={activeTrip} onSelectActivity={setEditingActivityId} />
            )}
            {lens === "Itinerary" && <ItineraryLens detail={activeTrip} onSelectActivity={setEditingActivityId} />}
            {lens === "Daily" && <DailyOverviewLens detail={activeTrip} />}
            {lens === "Trip" && <FullTripOverviewLens detail={activeTrip} />}
            {editingActivityId !== null && editingActivity !== null && (
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
          </PageContainer>
        )}
      </div>
    </>
  );
}
