"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useFocus } from "@/components/trip/context/FocusProvider";
import { useLens } from "@/components/trip/context/LensRouter";
import { chipModel, DayChips } from "@/components/trip/DayChips";
import { MapLens } from "@/components/lenses/MapLens";
import { ScheduleLens } from "@/components/lenses/ScheduleLens";
import { ItineraryLens } from "@/components/lenses/ItineraryLens";
import { DailyOverviewLens } from "@/components/lenses/DailyOverviewLens";
import { FullTripOverviewLens } from "@/components/lenses/FullTripOverviewLens";
import { Heading } from "@/components/ui/heading";
import { Button, buttonVariants } from "@/components/ui/button";
import { TripViewTabs } from "@/components/trip/TripViewTabs";
import { PageContainer } from "@/components/ui/page-container";
import { TripHeader } from "@/components/trip/TripHeader";
import { ActivityEditorSheet } from "@/components/trip/editor/ActivityEditorSheet";
import { AssistantRail } from "@/components/assistant/AssistantRail";
import { PREVIEW_QUICK_ASKS, PREVIEW_SUGGESTIONS } from "@/components/assistant/preview-fixtures";
import { composeAiPlan } from "@/lib/apiClient";
import { type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";
import { cn } from "@/lib/cn";

// Handoff `current/…dc.html:1111-1119`: the rail is an inline column at wide
// widths and an overlay below 1180px, where it starts hidden so it never covers
// the plan. A resize moves it back and forth — but only until the user makes
// their own choice, after which their preference wins at every width.
function useAssistantVisibility() {
  const [open, setOpen] = useState(true);
  const userChose = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1180px)");
    const sync = () => {
      if (!userChose.current) setOpen(mq.matches);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  return {
    open,
    show: () => {
      userChose.current = true;
      setOpen(true);
    },
    hide: () => {
      userChose.current = true;
      setOpen(false);
    },
  };
}

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const { trip, activeTrip, status, error, dispatch, applyOutcome, preview } = useTrip();
  const { lens } = useLens();
  const { openEdit } = useEditor();
  // Task 4's FocusProvider is mounted around this whole tree (trips/[tripId]/
  // page.tsx), so this hook must run unconditionally before the early
  // returns below — the day chips (Task 8) below the tab strip both read and
  // set it.
  const { focusedDay, setFocusedDay } = useFocus();
  // The rail's own "Hide"/re-show is real layout chrome now, not AI
  // behavior gated behind M9 — see AssistantRail.tsx's header comment.
  const assistant = useAssistantVisibility();
  const [askStatus, setAskStatus] = useState<"idle" | "loading" | "error">("idle");
  const [askError, setAskError] = useState<string | null>(null);

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

  // The Assistant rail's real ask box (M10 redesign-feedback follow-up):
  // the same composeAiPlan("board") call the old standalone ComposePanel
  // used to make directly, just triggered from the rail instead. The server
  // executes the model's plan as one atomic batch (Task 5.3) and returns the
  // resulting { detail, history } already reconciled — applyOutcome is the
  // same reconciler ComposePanel's board surface used, no refetch needed.
  const submitAssistantAsk = async (text: string) => {
    setAskStatus("loading");
    setAskError(null);
    const result = await composeAiPlan(tripId, text, "board");
    if (!result.ok) {
      setAskStatus("error");
      setAskError(result.error.message);
      return;
    }
    applyOutcome(result.value);
    setAskStatus("idle");
  };

  // Task L1: the page shell (P1) no longer pads its <main> (width="full"
  // px-0) so a non-full lens's own PageContainer width="content" can own
  // horizontal padding without doubling up. Chrome that's shared across all
  // lenses (the tab strip, the error banner) gets its padding from this
  // PageContainer width="full" wrapper instead.
  // Board is capped to content width (#31) — its columns scroll horizontally
  // (Task 11) rather than wrapping, so only Map remains full-bleed.
  const isFullLens = lens === "Map";

  // The assistant's context line — "Looking at Day N" once a day is focused
  // (Task 4's FocusProvider, already read above for the day chips), else
  // the trip itself. Used to say "Looking at all three of your trips" (a
  // fabricated cross-trip claim from when the whole rail was still a
  // Preview fixture) — now that the ask box is real and scoped to this one
  // trip's real composeAiPlan call, the fallback has to be honest about
  // that scope too.
  const assistantContextLine = focusedDay !== null ? `Looking at Day ${focusedDay + 1}` : `Looking at ${activeTrip.name}`;

  return (
    <>
      {/* .trip-board-content (globals.css): reserves 356px of right padding
          at >=1180px so real content (day columns, header actions) never
          sits underneath the fixed-position Assistant rail below — dropped
          via .assistant-hidden when the rail itself is hidden, so hiding it
          actually reclaims the width rather than leaving a dead gutter. */}
      <div className={cn("trip-board-content", !assistant.open && "assistant-hidden")}>
        <TripHeader tripId={tripId} />
        <PageContainer width="full">
          {error !== null && <p role="alert">{error}</p>}
          <TripViewTabs />
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
      {/* The assistant rail — real header/context/ask box (composeAiPlan,
          same as the removed standalone ComposePanel used to call directly)
          + still-Preview suggestions/quick-asks (AssistantRail.tsx wraps
          those two internally now, narrower than the old whole-rail wrap).
          Mounted once here (like ActivityEditorSheet below) so it's present
          regardless of which lens is active; it's fixed-position internally,
          so it doesn't affect any lens's own layout. Unmounted entirely
          (not just visually hidden) when the user hides it, so its fixed
          scrim/aside don't linger in the DOM. */}
      {assistant.open ? (
        <AssistantRail
          contextLine={assistantContextLine}
          suggestions={PREVIEW_SUGGESTIONS}
          quickAsks={PREVIEW_QUICK_ASKS}
          onAsk={(text) => void submitAssistantAsk(text)}
          asking={askStatus === "loading"}
          askError={askStatus === "error" ? askError : null}
          onKeepGhost={() => {}}
          onDismiss={() => {}}
          onHide={assistant.hide}
        />
      ) : (
        <Button
          variant="secondary"
          onClick={assistant.show}
          className="fixed right-0 top-1/2 z-50 -translate-y-1/2 rounded-r-none border-r-0 px-2 py-3 text-xs shadow-raised"
        >
          Assistant
        </Button>
      )}
      {/* Behavior change #2 (M5 wave 2, resolves #9): the activity editor is a
          portable Sheet raised via EditorHost, mounted once here outside the
          lens switch so it's available regardless of which lens is active. */}
      <ActivityEditorSheet />
    </>
  );
}
