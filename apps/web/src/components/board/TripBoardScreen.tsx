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
import { UnscheduledRack } from "@/components/trip/UnscheduledRack";
import { fitIntoDay } from "@/components/trip/unscheduledRack";
import { rackDisclosure, type RackDisclosure, type RackEvent } from "@/components/trip/rackDisclosure";
import { dayLabel } from "@/lib/dates";
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
  // Collapsed by default (Phase 3's design). The open flag is paired with who
  // opened it, because a drag auto-opens the drawer and must only re-close the
  // ones it opened itself — that rule lives in `rackDisclosure` (a pure
  // reducer with its own unit tests), not here.
  const [rack, setRack] = useState<RackDisclosure>({ open: false, openedByDrag: false });
  const onRackEvent = (event: RackEvent) => setRack((state) => rackDisclosure(state, event));
  // Whether the rail's last answer was simulated (ai-live flag off).
  const [askSimulated, setAskSimulated] = useState(false);

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

  // The unscheduled rack's contents: trip.backlog is the source of truth for
  // "parked", and each id resolves through activities. `area` reuses the same
  // city-else-name fallback DayChips.cityFor documents — location.city is the
  // geocoder's own city component, and .name is the only stand-in for a
  // location that predates that field or has no city-level component at all.
  // A backlog id with no matching activity is dropped rather than rendered as
  // a blank card.
  const rackItems = activeTrip.backlog.flatMap((activityId) => {
    const activity = activeTrip.activities[activityId];
    if (activity === undefined) return [];
    return [
      {
        activityId,
        title: activity.title,
        area: activity.location?.city ?? activity.location?.name ?? null,
        timeWindow: activity.timeWindow,
      },
    ];
  });
  const rackDayOptions = activeTrip.days.map((day, index) => ({
    value: day.dayId,
    label: dayLabel(activeTrip.startDate, index),
  }));

  // Scheduling from the rack is two commands, not one: MoveActivity puts the
  // stop on the day (the backlog↔day move the store already models), then
  // UpdateActivity gives it the real times fitIntoDay picks from the day's
  // existing windows. Both go through dispatch, so both land in the existing
  // undo history like every other mutation — no special-casing needed.
  const assignFromRack = (activityId: string, dayId: string) => {
    const day = activeTrip.days.find((d) => d.dayId === dayId);
    if (day === undefined) return;

    const existing = day.activityIds
      .map((id) => activeTrip.activities[id]?.timeWindow)
      .filter((w): w is { start: string; end: string } => w !== null && w !== undefined);

    void dispatch({ type: "MoveActivity", tripId, activityId, toDayId: dayId, position: day.activityIds.length });
    void dispatch({ type: "UpdateActivity", tripId, activityId, timeWindow: fitIntoDay(existing) });
  };

  // The mirror image of assignFromRack, and two commands for the same reason:
  // MoveActivity(toDayId: null) parks the stop, then UpdateActivity clears the
  // window — the design's "unscheduling strips the times". They are two
  // separate dispatches, so they are two separate batches in the event log and
  // therefore two separate undos (the same granularity assignFromRack already
  // has). A batch would need dispatchBatch, which would make unscheduling
  // atomic in a way scheduling isn't; keeping the two symmetrical is the more
  // predictable of the two. Clearing an already-empty window is a server-side
  // no-op (harmlessly swallowed by TripProvider), so a stop that had no time
  // costs only one undo.
  const unscheduleActivity = (activityId: string) => {
    void dispatch({
      type: "MoveActivity",
      tripId,
      activityId,
      toDayId: null,
      position: activeTrip.backlog.filter((id) => id !== activityId).length,
    });
    void dispatch({ type: "UpdateActivity", tripId, activityId, timeWindow: null });
    // The drop that got here also raised `dragEnd`, which re-closes a drawer
    // the drag itself opened. A park is the one drop that must not close it —
    // the drawer would shut over the stop just put in it — so ownership passes
    // to the user here.
    onRackEvent({ type: "parked" });
  };

  // The Assistant rail's real ask box (M10 redesign-feedback follow-up):
  // the same composeAiPlan("board") call the old standalone ComposePanel
  // used to make directly, just triggered from the rail instead. The server
  // executes the model's plan as one atomic batch (Task 5.3) and returns the
  // resulting { detail, history } already reconciled — applyOutcome is the
  // same reconciler ComposePanel's board surface used, no refetch needed.
  const submitAssistantAsk = async (text: string) => {
    setAskStatus("loading");
    setAskError(null);
    setAskSimulated(false);
    const result = await composeAiPlan(tripId, text, "board");
    if (!result.ok) {
      setAskStatus("error");
      setAskError(result.error.message);
      return;
    }
    setAskSimulated(result.value.simulated);
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
        <TripHeader tripId={tripId}>
          <TripViewTabs />
          {/* Task 2.3: MapRail replaces the chips row's job in map view — the
              two side by side would be redundant, and the chips row's own
              horizontal scroll makes no sense floating over a full-bleed map. */}
          {lens !== "Map" && <DayChips days={chipModel(activeTrip)} focusedDay={focusedDay} onSelect={setFocusedDay} />}
        </TripHeader>
        {error !== null && (
          <PageContainer width="full">
            <p role="alert">{error}</p>
          </PageContainer>
        )}
        <div inert={preview.seq !== null ? true : undefined}>
          {isFullLens ? (
            // px-0: Task 2.3 makes the Map lens genuinely full-bleed
            // ("mapwrap" in the handoff) — the default px-6 gutter would
            // leave the rail's 16px inset reading as ~40px instead.
            <PageContainer width="full" className="px-0">
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
                    onUnschedule: unscheduleActivity,
                    onDragStart: () => onRackEvent({ type: "dragStart" }),
                    onDragEnd: () => onRackEvent({ type: "dragEnd" }),
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
          simulated={askSimulated}
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
      {/* The unscheduled rack (Phase 3): mounted here, outside the lens
          switch, because the design has the drawer present in every view.
          It pins itself to the bottom of the viewport via `.unscheduled-rack`
          (globals.css) — see that rule for why `fixed`, not the design's
          `sticky`, is what actually pins it from this position in the DOM.
          Wrapped in the same inert treatment as the lens content above
          (preview.seq !== null): its "Add to day" dispatches real,
          persisted MoveActivity/UpdateActivity commands same as everything
          else, and dispatch itself has no preview guard — inert on the DOM
          subtree is the only thing stopping a mutation while browsing
          history, so the rack needs it too. */}
      <div inert={preview.seq !== null ? true : undefined}>
        <UnscheduledRack
          items={rackItems}
          dayOptions={rackDayOptions}
          open={rack.open}
          onToggle={() => onRackEvent({ type: "toggle" })}
          onAssign={assignFromRack}
        />
      </div>
    </>
  );
}
