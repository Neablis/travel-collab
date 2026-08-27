"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useFocus } from "@/components/trip/context/FocusProvider";
import { useLens } from "@/components/trip/context/LensRouter";
import { chipModel, DayChips } from "@/components/trip/DayChips";
import { MapLens } from "@/components/lenses/MapLens";
import { ScheduleLens } from "@/components/lenses/ScheduleLens";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { TripViewTabs } from "@/components/trip/TripViewTabs";
import { PageContainer } from "@/components/ui/page-container";
import { TripHeader } from "@/components/trip/TripHeader";
import { ActivityEditorSheet } from "@/components/trip/editor/ActivityEditorSheet";
import { UnscheduledRack } from "@/components/trip/UnscheduledRack";
import { fitIntoDay } from "@/components/trip/fitIntoDay";
import { rackDropWindow } from "./rackDropWindow";
import { lensAcceptsDrops } from "./lensAcceptsDrops";
import { rackDisclosure, type RackDisclosure, type RackEvent } from "@/components/trip/rackDisclosure";
import { dayLabel } from "@/lib/dates";
import { AssistantRail } from "@/components/assistant/AssistantRail";
import { PREVIEW_QUICK_ASKS } from "@/components/assistant/preview-fixtures";
import { composeAiPlan } from "@/lib/apiClient";
import { type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";
import { cn } from "@/lib/cn";

// Closed until asked for, at every width (Mitchell, walking the #71 preview:
// "Can we default the assistant to minimized? Its a better experience").
//
// This narrows the handoff (`current/…dc.html:1111-1119`), which had the rail
// as an inline column at wide widths and an overlay below 1180px that starts
// hidden. The overlay half is unchanged — that is layout, and it still never
// covers the plan uninvited. What changed is that a wide viewport no longer
// opens the rail on the reader's behalf: the plan is what someone came for,
// and the assistant is one click away rather than already occupying a column.
//
// The media query went with it rather than staying as dead weight. Its only
// job was deciding the default per width, and there is one default now; the
// overlay-vs-column treatment is CSS keyed off `assistant-hidden`, not this
// hook, so nothing responsive is lost. `userChose` went for the same reason —
// with no automatic opening there is no automatic decision left to override.
function useAssistantVisibility() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
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
  // CodeRabbit (PR #46 final review): the assistant's minimized launcher and
  // the unscheduled rack are both independently `position: fixed` to the
  // viewport (see UnscheduledRack's own comment for why the rack can't just
  // be a flow sibling) — nothing in normal layout keeps them apart. Below
  // 1180px (or above it, if the user hides the rail manually — same
  // launcher, same fixed bottom-right spot) every non-Map lens has the rack
  // pinned across that same bottom edge, so a static offset covered a real
  // slice of the rack — collapsed, and worse once open, since the rack's own
  // height then grows with its card row. Measuring the rack's actual
  // rendered height and clearing it is the only offset that survives both
  // the open/collapsed toggle and the item count changing.
  //
  // `node.firstElementChild`, not the wrapper div itself: the rack's own root
  // is `position: fixed` (UnscheduledRack/globals.css), so it never
  // contributes to its static-positioned wrapper's flow height — that wrapper
  // would always measure 0. The wrapper ref is only a DOM foothold to reach
  // the fixed child's own real box (getBoundingClientRect reports a fixed
  // element's true viewport rect regardless of its ancestors' layout),
  // without UnscheduledRack needing to forward a ref.
  //
  // A **callback ref**, not useEffect+useRef, and this is the whole point
  // (Phase 9 gate walk): the wrapper is mounted by the JSX *below* the
  // `status === "loading"` early return, so on the first commit it does not
  // exist. An effect keyed on `[lens]` therefore ran once against a null ref,
  // set the height to 0, registered no observer — and never re-ran, because
  // the lens had not changed. The measured height stayed 0 for the life of
  // the page, `bottom` stayed at the bare 24px, and the launcher sat over the
  // rack it is supposed to clear: 15px of it collapsed, 212px once open. A
  // callback ref fires when the node actually appears, whatever gated it.
  const rackObserverRef = useRef<ResizeObserver | null>(null);
  const [rackHeight, setRackHeight] = useState(0);
  const rackWrapperRef = useCallback((node: HTMLDivElement | null) => {
    rackObserverRef.current?.disconnect();
    rackObserverRef.current = null;
    // React attaches refs bottom-up, so the rack's own <section> is already in
    // the DOM by the time this runs for its wrapper.
    const el = node?.firstElementChild ?? null;
    if (!el) {
      setRackHeight(0);
      return;
    }
    const observer = new ResizeObserver(() => setRackHeight(el.getBoundingClientRect().height));
    observer.observe(el);
    rackObserverRef.current = observer;
  }, []);
  useEffect(() => () => rackObserverRef.current?.disconnect(), []);

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
    // I3 (final review): this used to be `<Heading level={1}>Caesura</Heading>`
    // plus a bare link to Auth.js's default `/api/auth/signin` — exactly the
    // bare-front-door pattern M15's "Why this exists" names as the problem
    // this milestone eliminates, left untouched here even though the rest of
    // the app moved to the designed `/signin` screen (AuthScreen.tsx). It
    // also dropped `callbackUrl` on the floor: `server/auth.ts` now routes
    // sign-in through our own screen, which reads `callbackUrl` and restores
    // it after a successful sign-in (see AuthScreen.tsx / safeCallbackUrl.ts)
    // — so linking here at our own `/signin` with the trip as the callback
    // target returns a signed-out deep-linker to the trip they asked for,
    // the same as Auth.js's own default page used to.
    //
    // CodeRabbit (PR #56, finding 1): `src/middleware.ts` now guards
    // `/trips/:path*` (and `/playbooks/:path*`) the same way it already
    // guarded `/`, so a signed-out *arrival* at this route never reaches
    // this component at all — it's redirected to `/signin?callbackUrl=...`
    // at the HTTP layer before rendering starts. That makes this branch
    // unreachable in the normal flow, but it is not dead code: it remains
    // the correct fallback for a session that expires while this page is
    // already open (a `useTrip` refetch turns up a 401 mid-session), the
    // same division of labour — middleware owns arrival, the component owns
    // expiry-in-place — that `(app)/page.tsx`'s Home documents for `/`.
    return (
      <PageContainer width="full">
        <div className="flex flex-col items-start gap-3 py-10">
          <Heading level={1}>Sign in to see this trip</Heading>
          <Text as="p" variant="secondary">
            This trip is waiting — sign in to pick up where the group left off.
          </Text>
          <Link
            href={`/signin?callbackUrl=${encodeURIComponent(`/trips/${tripId}`)}`}
            className={cn(buttonVariants({ variant: "primary" }), "mt-1")}
          >
            Sign in
          </Link>
        </div>
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

  // Dragging a parked stop onto a day is the same two-command job
  // assignFromRack does — MoveActivity, then a real time — but the drag knows
  // something the day dropdown doesn't: WHERE in the day you dropped it
  // (Mitchell, preview feedback on PR #55: "dragging a unscheduled element
  // into the UI should set the time between the elements it was dropped
  // between"). Before this the drag dispatched a bare MoveActivity, so a stop
  // dragged from the rack landed on the day still holding no time at all,
  // while the dropdown path gave it one — the same action, two outcomes.
  //
  // fitIntoDay already takes a preferred start; the drop index is what feeds
  // it. The stop above the drop point hands over its end time, and fitIntoDay
  // searches forward from there for a gap that actually fits, so dropping into
  // a full stretch of the day still yields a real window rather than one
  // overlapping its neighbours. Dropped at the top (position 0) there is no
  // stop above, so it falls back to the day's own default.
  //
  // The drag's counterpart to assignFromRack: MoveActivity, then a real time.
  // The decision of WHICH time — and whether to set one at all — is
  // rackDropWindow, a pure function so it can be tested without a drag
  // (rackDropWindow.ts explains why, and carries the reasoning that used to
  // live here). `activeTrip` is read before the dispatch on purpose: the move
  // is applied optimistically and empties the backlog the decision reads.
  const moveActivity = (activityId: string, toDayId: string | null, position: number) => {
    const timeWindow = rackDropWindow(activeTrip, activityId, toDayId, position);
    void dispatch({ type: "MoveActivity", tripId, activityId, toDayId, position });
    if (timeWindow !== null) void dispatch({ type: "UpdateActivity", tripId, activityId, timeWindow });
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
  // Only Map is full-BLEED (no gutter, and it reclaims the assistant rail's
  // reserved strip). Board is a separate case: full WIDTH, normal gutter,
  // rail still respected — see boardUsesFullWidth below.
  const isFullLens = lens === "Map";

  // Board opts out of the 1120px content cap. That cap (#31, wave-3 Area 1)
  // was decided as one half of a pair: "cap the board to a max content width"
  // AND "day columns flow into a wrapped grid instead of a single
  // horizontally-scrolling row — all days visible, no horizontal scroll."
  // A readable measure is the right call for a wrapped grid. The design later
  // went back to scrolling columns (Board.tsx: handoff §"Day columns view",
  // 268px columns "rather than wrapping into rows") and the cap stayed behind,
  // which is the worst of both: you scroll MORE, because the row is 1072px of
  // a 1728px window with the leftover 250px sitting as empty gutter either
  // side of a centred container (measured, 2026-08-26). That is what Mitchell
  // reported on PR #55 — "why cant we use more of the screen when scrolling
  // left and right?" — and it is close to the original wave-3 ask the cap was
  // meant to serve ("we probably don't even want to have to scroll right").
  //
  // So this is not reversing #31 so much as finishing a reversal already made
  // elsewhere. Timeline and Calendar keep the cap: they scroll vertically, and
  // a 1372px-wide line of prose or a 1372px calendar cell is worse, not
  // better.
  const boardUsesFullWidth = lens === "Board";

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
          actually reclaims the width rather than leaving a dead gutter. It
          also gives lens content a bottom margin against the page, dropped
          via .full-bleed for the Map lens, which is deliberately full-bleed
          (same `isFullLens` this component already computes below). */}
      <div className={cn("trip-board-content", !assistant.open && "assistant-hidden", isFullLens && "full-bleed")}>
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
            <PageContainer width={boardUsesFullWidth ? "full" : "content"}>
              {lens === "Board" && (
                <Board
                  trip={activeTrip}
                  focusedDay={focusedDay}
                  callbacks={{
                    onSelectDay: setFocusedDay,
                    onMove: moveActivity,
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
              {lens === "Schedule" && (
                <ScheduleLens
                  detail={activeTrip}
                  onSelectActivity={openEdit}
                  // The timeline raises real commands through this one seam:
                  // UpdateActivity for the overlap warning's one-click fix,
                  // DismissConflict for its dismissal, and — Phase 6 — AddDay
                  // from the end-of-trip block's "Add a day". That last one is
                  // deliberately the SAME `dispatch({ type: "AddDay", tripId,
                  // dayId: crypto.randomUUID() })` the Board lens's `onAddDay`
                  // above performs, just arriving pre-built (the seam carries
                  // whole commands) rather than as a bare callback. None of
                  // the three is ever a CreateTrip, which is the only
                  // TripCommand dispatch doesn't take. The timeline scrolls
                  // the appended day into view itself, via the focus effect it
                  // already owns — see TimelineLens's `addDay`.
                  onCommand={(command) => {
                    if (command.type !== "CreateTrip") void dispatch(command);
                  }}
                />
              )}
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
          quickAsks={PREVIEW_QUICK_ASKS}
          onAsk={(text) => void submitAssistantAsk(text)}
          asking={askStatus === "loading"}
          askError={askStatus === "error" ? askError : null}
          simulated={askSimulated}
          onHide={assistant.hide}
        />
      ) : (
        // Matches the design's minimized launcher (`Trip Planner Redesign
        // .dc.html:1058-1063`): a filled-brand pill FAB pinned bottom-right,
        // not the edge-tab treatment this used to have (variant="secondary",
        // rounded-r-none, vertically centered against the right edge) — the
        // design has no bordered edge-tab state for the assistant, only this
        // pill. Icon mirrors AssistantRail's own open-state mark glyph (◎,
        // same component's header).
        <Button
          variant="primary"
          onClick={assistant.show}
          className="fixed right-6 z-40 h-auto gap-2 rounded-full px-4 py-2.5 text-base font-semibold shadow-overlay"
          // eslint-disable-next-line no-restricted-syntax -- bottom offset clears the unscheduled rack's own measured height (see rackHeight above), which changes with its open state and item count — not expressible as a static token.
          style={{ bottom: rackHeight > 0 ? rackHeight + 24 : 24 }}
        >
          <span aria-hidden>◎</span>
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
          history, so the rack needs it too.
          Rendered only where a stop can actually be dropped onto the page
          (`lensAcceptsDrops`, which is Board today). RULES.md 2 — "don't
          render the bottom drawer on a page where activities can't be dragged
          onto or out of the schedule" — and Mitchell's call on it, 2026-08-26:
          remove it for now, and add it back per lens as that lens gains real
          page interactions. This reverses the 2026-08-25 decision recorded in
          STATUS.md, which kept it on Timeline and Calendar for its day-assign
          `NativeSelect`; that dropdown is a real scheduling path, but it is
          reachable from the Board drawer, so keeping a fixed overlay mounted
          on two lenses for it alone is the "purposeless UI" the rule is about.
          The gate is a question about drop targets rather than a lens list so
          the drawer comes back on its own when Timeline and Calendar get
          theirs (TODO.md's four rack/lens gaps). */}
      {lensAcceptsDrops(lens) && (
        <div ref={rackWrapperRef} inert={preview.seq !== null ? true : undefined}>
          <UnscheduledRack
            items={rackItems}
            dayOptions={rackDayOptions}
            open={rack.open}
            onToggle={() => onRackEvent({ type: "toggle" })}
            onAssign={assignFromRack}
          />
        </div>
      )}
    </>
  );
}
