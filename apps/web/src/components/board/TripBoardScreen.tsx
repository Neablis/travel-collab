"use client";

import Link from "next/link";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useFocus } from "@/components/trip/context/FocusProvider";
import { LENSES, useLens } from "@/components/trip/context/LensRouter";
import { chipModel, DayChips } from "@/components/trip/DayChips";
import { MapLens } from "@/components/lenses/MapLens";
import { ScheduleLens } from "@/components/lenses/ScheduleLens";
import { ItineraryLens } from "@/components/lenses/ItineraryLens";
import { DailyOverviewLens } from "@/components/lenses/DailyOverviewLens";
import { FullTripOverviewLens } from "@/components/lenses/FullTripOverviewLens";
import { Heading } from "@/components/ui/heading";
import { buttonVariants } from "@/components/ui/button";
import { TabStrip } from "@/components/ui/tab-strip";
import { PageContainer } from "@/components/ui/page-container";
import { Preview } from "@/components/ui/preview";
import { TripHeader } from "@/components/trip/TripHeader";
import { ActivityEditorSheet } from "@/components/trip/editor/ActivityEditorSheet";
import { ComposePanel } from "@/components/pages/ai/ComposePanel";
import { AssistantRail } from "@/components/assistant/AssistantRail";
import { PREVIEW_CONTEXT_LINE, PREVIEW_QUICK_ASKS, PREVIEW_SUGGESTIONS } from "@/components/assistant/preview-fixtures";
import { type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";
import { cn } from "@/lib/cn";

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const { trip, activeTrip, status, error, dispatch, applyOutcome, preview } = useTrip();
  const { lens, setLens } = useLens();
  const { openEdit } = useEditor();
  // Task 4's FocusProvider is mounted around this whole tree (trips/[tripId]/
  // page.tsx), so this hook must run unconditionally before the early
  // returns below — the day chips (Task 8) below the tab strip both read and
  // set it.
  const { focusedDay, setFocusedDay } = useFocus();

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
        <Link
          href={`/api/auth/signin?callbackUrl=/trips/${tripId}`}
          className={cn(buttonVariants({ variant: "secondary" }), "mt-4")}
        >
          Sign in
        </Link>
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
  // lenses (the tab strip, the error banner) gets its padding from this
  // PageContainer width="full" wrapper instead.
  // Board is capped to content width (#31) — its columns scroll horizontally
  // (Task 11) rather than wrapping, so only Map remains full-bleed.
  const isFullLens = lens === "Map";

  // Task 14 (M9 Preview shell): the assistant's real-shaped context line —
  // "Looking at Day N" once a day is focused (Task 4's FocusProvider,
  // already read above for the day chips), else a sensible trip-wide
  // default. Presentational only; nothing downstream reacts to it yet.
  const assistantContextLine = focusedDay !== null ? `Looking at Day ${focusedDay + 1}` : PREVIEW_CONTEXT_LINE;

  return (
    <>
      {/* .trip-board-content (globals.css, gate-verification fix): reserves
          356px of right padding at >=1180px so real content (day columns,
          header actions) never sits underneath the fixed-position Assistant
          rail below — see that class's comment for the full story (the
          rail's own <Preview> wrapper hit-tests across its whole box since
          only its inner children carry pointer-events:none; unrelated to
          the separate m8-make-it-real.spec.ts drag-to-day-3 regression,
          which was page-height overflow — see Board.tsx). */}
      <div className="trip-board-content">
        <TripHeader tripId={tripId} />
        <PageContainer width="full">
          {error !== null && <p role="alert">{error}</p>}
          <TabStrip
            value={lens}
            onValueChange={setLens}
            options={LENSES.map((l) => ({ value: l, label: l }))}
            aria-label="Trip view"
          />
          {/* Task 8: day-chips row, real TripDetail data, presentational-only
              except for setting focus (Task 4's FocusProvider) — no lens or
              command change. Lives under the tab strip so it's visible across
              every lens, not just Board. */}
          <div className="mt-2">
            <DayChips days={chipModel(activeTrip)} focusedDay={focusedDay} onSelect={setFocusedDay} />
          </div>
        </PageContainer>
        <div inert={preview.seq !== null ? true : undefined}>
          {isFullLens ? (
            <PageContainer width="full">
              {lens === "Map" && <MapLens detail={activeTrip} onSelectActivity={openEdit} />}
            </PageContainer>
          ) : (
            <PageContainer width="content">
              {lens === "Board" && (
                <div className="mb-3">
                  {/* The AI route executes the model's plan as one atomic batch
                      server-side (Task 5.3), so there's nothing for the client to
                      predict — we reconcile in place from the authoritative
                      { detail, history } the response already returns (no refetch,
                      no page reload; ComposePanel's summary stays on screen). */}
                  <ComposePanel tripId={tripId} surface="board" onApplied={applyOutcome} />
                </div>
              )}
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
              {lens === "Schedule" && <ScheduleLens detail={activeTrip} onSelectActivity={openEdit} />}
              {lens === "Itinerary" && <ItineraryLens detail={activeTrip} onSelectActivity={openEdit} />}
              {lens === "Daily" && <DailyOverviewLens detail={activeTrip} />}
              {lens === "Trip" && <FullTripOverviewLens detail={activeTrip} />}
            </PageContainer>
          )}
        </div>
      </div>
      {/* Task 14 (M9 Preview shell): the assistant rail — sample suggestions
          + quick-asks + no-op handlers per the plan's real prop contract.
          Mounted once here (like ActivityEditorSheet below) so it's present
          regardless of which lens is active; it's fixed-position internally,
          so it doesn't affect any lens's own layout. Wrapped in <Preview>
          (Task 3's seam), which shields pointer events and stamps the
          "Preview · M9" chip — none of these handlers fire yet.
          Fix (Task 14 review): AssistantRail's own contents are
          `position: fixed` (a viewport-relative scrim + the `<aside>` rail
          itself), so they contribute zero height to normal flow and
          Preview's `relative` wrapper — the containing block for its
          absolute "Preview · M9" badge — collapses to a zero-size box
          wherever this <Preview> falls in TripBoardScreen's flow, instead
          of sitting at the rail's actual on-screen position. Giving
          Preview's own wrapper the same fixed inset-y-0 right-0 + 356px box
          as AssistantRail's <aside> (via .assistant-rail-panel, globals.css)
          gives it real, correctly-positioned dimensions, so the badge
          anchors to the visible rail's corner. This does not double-clip
          the scrim: `position: fixed` is viewport-relative regardless of an
          ancestor's own position, unless that ancestor sets
          transform/filter/perspective/will-change, which none here do. */}
      <Preview id="assistant-rail" className="assistant-rail-panel fixed inset-y-0 right-0 z-50">
        <AssistantRail
          contextLine={assistantContextLine}
          suggestions={PREVIEW_SUGGESTIONS}
          quickAsks={PREVIEW_QUICK_ASKS}
          onAsk={() => {}}
          onKeepGhost={() => {}}
          onDismiss={() => {}}
          onHide={() => {}}
        />
      </Preview>
      {/* Behavior change #2 (M5 wave 2, resolves #9): the activity editor is a
          portable Sheet raised via EditorHost, mounted once here outside the
          lens switch so it's available regardless of which lens is active. */}
      <ActivityEditorSheet />
    </>
  );
}
