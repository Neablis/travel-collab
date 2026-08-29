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
import { shortPlace } from "@/lib/place";
import { isDemoTripId } from "@/lib/demoTrip";
import { dayLabel } from "@/lib/dates";
import { AssistantRail } from "@/components/assistant/AssistantRail";
import { toolNoteLabel, type AssistantTurn } from "@/components/assistant/Transcript";
import { suggestedQuestions } from "@/components/assistant/suggestedQuestions";
import {
  AI_NOT_ENTITLED_CODE,
  ASK_ABORTED_CODE,
  DEMO_TRIP_UNSUPPORTED_CODE,
  answerIsSimulated,
  askAssistant,
  type ApiError,
  type AskScope,
  type AskWireMessage,
} from "@/lib/apiClient";
import { type ActivityFormValue } from "./ActivityEditor";
import { Board } from "./Board";
import { cn } from "@/lib/cn";

// Closed until asked for, at every width (Mitchell, walking the #71 preview:
// "Can we default the assistant to minimized? Its a better experience").
//
// This narrows the handoff (`current/…dc.html:1111-1119`), which had the rail
// as an inline column at wide widths and an overlay below 1180px that starts
// hidden. What changed here first was that a wide viewport no longer opens
// the rail on the reader's behalf: the plan is what someone came for, and
// the assistant is one click away rather than already occupying a column.
// M16 Wave 1 (Task 4, SPEC §9 "the assistant — one panel, three
// presentations") later replaced the overlay half too — the rail is a real
// flex sibling of the plan at every width now, not an overlay below 1180px,
// so there is no overlay-vs-column split left to gate on width at all;
// docked is unconditional.
//
// The media query went with it rather than staying as dead weight. Its only
// job was deciding the default per width, and there is one default now.
// `userChose` went for the same reason — with no automatic opening there is
// no automatic decision left to override.
// What the rail SAYS when an ask fails. Branches on the server's `code`, not
// its prose: a refusal's wording is free to change, and two of these are
// refusals rather than failures. Everything else falls through to the
// server's own message on purpose — /ask's 400s are specific and actionable
// ("this trip has 5 days, so day 9 is out of range", "your message must be
// 4000 characters or fewer") and rewriting them here would throw that away.
function askErrorMessage(error: ApiError): string {
  if (error.code === DEMO_TRIP_UNSUPPORTED_CODE) return "The assistant isn't available on the demo trip.";
  if (error.code === AI_NOT_ENTITLED_CODE) return "The assistant is switched off for this account.";
  return error.message;
}

function useAssistantVisibility() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const { trip, activeTrip, status, error, dispatch, preview, pending, readOnly } = useTrip();
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
  // The demo board (`/demo`, ADR-031) runs everything on this screen except
  // the assistant. Not because it would look wrong — because it would not
  // work: `/api/trips/:id/ask` refuses the demo trip outright with a 403
  // `demo-trip-unsupported` (KI-79), so a launcher offered to a signed-out
  // visitor has no outcome but an error. This is the one control on the board
  // with no read-only half to fall back to.
  const isDemo = isDemoTripId(tripId);
  const [askStatus, setAskStatus] = useState<"idle" | "loading" | "error">("idle");
  const [askError, setAskError] = useState<string | null>(null);
  // The conversation itself, oldest turn first. See runAsk below for why it
  // lives here rather than in the rail.
  const [thread, setThread] = useState<AssistantTurn[]>([]);
  // Turn ids only have to be unique within one thread and stable across
  // re-renders; a counter says so and stays deterministic under test, where
  // crypto.randomUUID would not.
  const turnSeq = useRef(0);
  // Held so "New conversation" can hang up on a turn that is still streaming.
  // Without it the composer stays disabled behind an answer nobody wants.
  const askAbort = useRef<AbortController | null>(null);
  // The scope of every question asked from this page, and the SINGLE source
  // the rail's context line is worded from (below). They were allowed to be
  // two derivations of `focusedDay` and that is exactly how a rail says
  // "Looking at Day 3" while asking the server about the whole trip.
  // `dayIndex` is 0-based, matching TripDetail.days and /ask's scope; the day
  // NUMBER a human reads is +1, and that conversion happens in one place.
  const askScope: AskScope = focusedDay !== null ? { kind: "day", dayIndex: focusedDay } : { kind: "trip" };
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
    // CodeRabbit (PR #56, finding 1): `src/proxy.ts` now guards
    // `/trips/:path*` (and `/playbooks/:path*`) the same way it already
    // guarded `/`, so a signed-out *arrival* at this route never reaches
    // this component at all — it's redirected to `/signin?callbackUrl=...`
    // at the HTTP layer before rendering starts. That makes this branch
    // unreachable in the normal flow, but it is not dead code: it remains
    // the correct fallback for a session that expires while this page is
    // already open (a `useTrip` refetch turns up a 401 mid-session), the
    // same division of labour — the proxy owns arrival, the component owns
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
  // "parked", and each id resolves through activities. The card's `area` slot
  // is `shortPlace()` — the same area-then-city-then-name-segment order the
  // timeline's place line uses. It used to inline `city ?? name`, which put
  // the venue's own name ("Ugly Duck Coffee") in a slot that means
  // "whereabouts": KI-35's exact defect, at a call site that entry never
  // named. Now that Location carries a real `area`, the helper is what fills
  // it honestly, and the rack agrees with every other place line in the app.
  // A backlog id with no matching activity is dropped rather than rendered as
  // a blank card.
  const rackItems = activeTrip.backlog.flatMap((activityId) => {
    const activity = activeTrip.activities[activityId];
    if (activity === undefined) return [];
    return [
      {
        activityId,
        title: activity.title,
        area: shortPlace(activity.location),
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

  // The Assistant rail's conversation (M16 Wave 2, Task 5). It posts to
  // /api/trips/:id/ask — the READ-only streaming agent — not to the command
  // endpoint the rail used to call.
  //
  // Why the rail stopped calling `composeAiPlan`: that endpoint answers with a
  // derived receipt for a batch it has already applied, which is structurally
  // the wrong channel for "have a discussion" (ADR-022 §4 says so outright).
  // Two ask boxes side by side — one that talks, one that silently rewrites
  // your trip — is worse than either. `composeAiPlan` itself is untouched and
  // still exported; Task 6 brings applying a plan back through THIS endpoint,
  // as write tools behind an explicit approval, which is the version anyone
  // actually wanted. Until it lands, the board cannot apply an AI plan from
  // the browser — recorded as a deliberate one-task gap, not an oversight.
  //
  // Conversation state is client-held (Ruling R1): there is no conversations
  // table and no migration in this plan, so `thread` IS the conversation and
  // the whole of it is posted back on every turn. It survives hiding the rail
  // (this component stays mounted) and dies with the page, which is the
  // honest lifetime for something the server keeps nothing of.
  const nextTurnId = (prefix: string) => {
    turnSeq.current += 1;
    return `${prefix}${turnSeq.current}`;
  };

  const runAsk = async (text: string) => {
    const userTurn: AssistantTurn = { id: nextTurnId("u"), role: "user", text };
    const answerId = nextTurnId("a");
    // `thread` from this render's closure is the thread the user is looking
    // at: only one turn can be in flight (the composer and the suggestion
    // chips are both disabled while `asking`), so there is no newer one.
    const posted: AskWireMessage[] = [
      ...thread
        // A turn that failed before it produced any text is dropped below, but
        // a partial one is kept — and an empty `parts` array is not a message
        // the server's validator will accept.
        .filter((turn) => turn.text.trim() !== "")
        .map((turn) => ({ id: turn.id, role: turn.role, parts: [{ type: "text" as const, text: turn.text }] })),
      { id: userTurn.id, role: "user" as const, parts: [{ type: "text" as const, text }] },
    ];
    setThread((current) => [
      ...current,
      userTurn,
      { id: answerId, role: "assistant", text: "", tools: [], pending: true },
    ]);
    setAskStatus("loading");
    setAskError(null);
    setAskSimulated(false);

    const controller = new AbortController();
    askAbort.current = controller;

    // Only ever touches the one answer turn this call owns, by id — a stale
    // stream that outlived its turn cannot write into a newer one.
    const patchAnswer = (fn: (turn: Extract<AssistantTurn, { role: "assistant" }>) => AssistantTurn) =>
      setThread((current) => current.map((t) => (t.id === answerId && t.role === "assistant" ? fn(t) : t)));

    const result = await askAssistant(
      tripId,
      posted,
      askScope,
      (event) => {
        if (event.type === "text") {
          patchAnswer((turn) => ({ ...turn, text: turn.text + event.delta }));
        } else if (event.type === "tool") {
          patchAnswer((turn) => ({
            ...turn,
            tools: [...turn.tools, { id: event.toolCallId, label: toolNoteLabel(event.toolName, event.input) }],
          }));
        }
      },
      controller.signal,
    );
    askAbort.current = null;

    if (result.ok) {
      // The ai-live flag is off in every Vercel environment, so this is the
      // deployed path: a real answer, composed from real trip data by the
      // server rather than by a model, and labelled as such.
      setAskSimulated(answerIsSimulated(result.value.text));
      patchAnswer((turn) => ({ ...turn, pending: false }));
      setAskStatus("idle");
      return;
    }

    // Abandoned by "New conversation": its turn is already gone, and the user
    // asked for it. Not an error.
    if (result.error.code === ASK_ABORTED_CODE) return;

    // A turn that produced no text at all did not happen — drop both halves so
    // the thread stays a conversation rather than accumulating orphan
    // questions, and let the inline error carry the reason. A turn that got
    // PART of an answer out keeps it: the words are on screen already, and
    // deleting them under the user is the worse lie.
    setThread((current) => {
      const answer = current.find((t) => t.id === answerId);
      if (answer !== undefined && answer.text !== "") {
        return current.map((t) => (t.id === answerId && t.role === "assistant" ? { ...t, pending: false } : t));
      }
      return current.filter((t) => t.id !== answerId && t.id !== userTurn.id);
    });
    setAskStatus("error");
    setAskError(askErrorMessage(result.error));
  };

  const submitAssistantAsk = async (text: string) => {
    // A viewer's ask is refused here even though /ask itself admits a viewer
    // (ASK_MINIMUM_ROLE) and writes nothing. Kept deliberately, and no longer
    // for the reason the command path had: this is now a product call about
    // who the assistant is offered to, not a mechanical guard against a batch
    // the server would refuse. Revisit it in Task 6, when write tools arrive
    // and `minimumRoleFor` has an editor half to gate on.
    // Reported through the rail's own askError surface rather than swallowed —
    // a control that silently does nothing is the failure mode TripProvider's
    // runDispatch comment was written about.
    if (readOnly) {
      setAskStatus("error");
      setAskError("You have view-only access to this trip.");
      setAskSimulated(false);
      return false;
    }
    // Refused while the optimistic queue still holds unsent work. The original
    // reason was a data-loss race — the AI batch was decided against server
    // state that did NOT include those units, and `applyOutcome` cleared
    // `pending` to take its result, discarding a queued-but-unsent drag from
    // the UI and the server both (docs/reviews/2026-08-28-project-review.md
    // §1.4). /ask applies nothing, so that race is gone; what remains is that
    // the assistant would read the trip WITHOUT the edits on screen and
    // confidently answer about a plan the user is not looking at. Same
    // refusal, same copy, a reason that is still real.
    if (pending) {
      setAskStatus("error");
      setAskError("Finish saving your changes before asking the assistant.");
      setAskSimulated(false);
      // false keeps the rail's typed prompt on screen: this ask never reached
      // the model, so making the user retype it would read as a broken box.
      return false;
    }
    // Deliberately NOT awaited: the answer streams for seconds, and the rail
    // clears its composer on whatever this resolves to. Accepting the ask is
    // the thing the composer waits for; the answer arrives in `thread`.
    void runAsk(text);
    return true;
  };

  const startNewConversation = () => {
    askAbort.current?.abort();
    askAbort.current = null;
    setThread([]);
    setAskStatus("idle");
    setAskError(null);
    setAskSimulated(false);
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
  // fabricated cross-trip claim from when the whole rail was still a Preview
  // fixture); the fallback has to be honest about the scope the question is
  // actually asked in, so it is worded FROM `askScope` rather than from a
  // second reading of `focusedDay`.
  const assistantContextLine =
    askScope.kind === "day" ? `Looking at Day ${askScope.dayIndex + 1}` : `Looking at ${activeTrip.name}`;

  // Derived from the trip in front of the user, never canned — the rules and
  // the reasoning are in suggestedQuestions.ts. Recomputed per render because
  // it is a pure walk of the days and it MUST change when the focused day
  // does; memoising it on `activeTrip` identity would be the bug.
  const assistantSuggestions = suggestedQuestions(activeTrip, focusedDay);

  return (
    <>
      {/* M16 Wave 1 (Task 4, SPEC §9 docked presentation): the Assistant rail
          is a real flex sibling of the plan now, not `position: fixed` over
          it — this row is what makes the plan genuinely SHRINK by 356px when
          the rail opens, rather than being overlaid with a scrim in front of
          it (KI-16, KI-17). `.assistant-open` (globals.css) is the marker the
          unscheduled rack's own `position: fixed` right-inset reads, since a
          fixed element ignores this row's flex sizing entirely and needs its
          own compensation to stop short of the docked rail instead of
          running underneath it. */}
      <div className={cn("flex items-start", !isDemo && assistant.open && "assistant-open")}>
        {/* .trip-board-content (globals.css): gives lens content a bottom
            margin against the page, dropped via .full-bleed for the Map
            lens, which is deliberately full-bleed (same `isFullLens` this
            component already computes below). `min-w-0` lets this column
            actually shrink when the rail opens — flex items default to a
            min-width of their content's intrinsic width, which a
            horizontally-scrolling day-columns row would otherwise refuse to
            go below. */}
        <div className={cn("trip-board-content min-w-0 flex-1", isFullLens && "full-bleed")}>
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
                {/* Main's rule: a viewer does not get the jump into the stop
                    editor, so `onSelectActivity` is withheld (ADR-031). The
                    `readOnly` prop is the half that rule does not reach —
                    double-click-to-create calls `openCreate` from useEditor()
                    directly, not through this callback, so without it a viewer
                    could still raise the editor in create mode. */}
                {lens === "Map" && (
                  <MapLens
                    detail={activeTrip}
                    onSelectActivity={readOnly ? undefined : openEdit}
                    readOnly={readOnly}
                  />
                )}
              </PageContainer>
            ) : (
              <PageContainer width={boardUsesFullWidth ? "full" : "content"}>
                {lens === "Board" && (
                  <Board
                    trip={activeTrip}
                    focusedDay={focusedDay}
                    // A viewer's board, and the demo's, show the plan and offer
                    // nothing that changes it (ADR-031). `readOnly` comes from
                    // the provider's own gate — the same flag that already
                    // refuses the command — so the controls and the refusal can
                    // never disagree about who may edit. The same reasoning
                    // reached here independently from the M11 side
                    // (docs/reviews/2026-08-28-m11-pr71-review.md §5): the point
                    // is the difference between an inert board and one whose
                    // cards move and snap back.
                    readOnly={readOnly}
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
                    readOnly={readOnly}
                    onSelectActivity={readOnly ? undefined : openEdit}
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
                      // All three commands this seam carries (UpdateActivity,
                      // DismissConflict, AddDay) are writes, so a viewer has
                      // nothing legitimate to raise through it. Unreachable
                      // today — the timeline withholds every affordance that
                      // would raise one (`readOnly` above), and TripProvider's
                      // `dispatch` refuses a viewer as well — and kept for the
                      // same reason ActivityEditorSheet's handleSave guard is:
                      // so the refusal does not depend on a render branch
                      // somewhere below staying correct. The server refuses each
                      // of them independently (accessPolicy.ts) and remains the
                      // real gate; this is defence in depth.
                      if (readOnly) return;
                      if (command.type !== "CreateTrip") void dispatch(command);
                    }}
                  />
                )}
              </PageContainer>
            )}
          </div>
        </div>
        {/* The assistant rail — a real streaming conversation against
            /api/trips/:id/ask (see runAsk above). Mounted here, as the row's
            second flex child, so it's present regardless of which lens is
            active and its 356px width comes out of real layout (see the row's
            own comment above) rather than a fixed-position overlay. Unmounted
            entirely (not just visually hidden) when the user hides it, so it
            costs the row nothing when closed — the thread lives in this
            component, so hiding the rail does not end the conversation. */}
        {!isDemo && assistant.open && (
          <AssistantRail
            contextLine={assistantContextLine}
            turns={thread}
            suggestions={assistantSuggestions}
            onNewConversation={startNewConversation}
            onAsk={(text) => submitAssistantAsk(text)}
            asking={askStatus === "loading"}
            askError={askStatus === "error" ? askError : null}
            simulated={askSimulated}
            onHide={assistant.hide}
          />
        )}
      </div>
      {!isDemo && !assistant.open && (
        // Matches the design's minimized launcher (`Trip Planner Redesign
        // .dc.html:1058-1063`): a filled-brand pill FAB pinned bottom-right,
        // not the edge-tab treatment this used to have (variant="secondary",
        // rounded-r-none, vertically centered against the right edge) — the
        // design has no bordered edge-tab state for the assistant, only this
        // pill. Icon mirrors AssistantRail's own open-state mark glyph (◎,
        // same component's header). Stays `position: fixed`, outside the row
        // above — a closed rail costs no layout, so there is nothing for it
        // to be a flex sibling of.
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
      {/* The rack is a drop target and an "add to day" picker — both writes.
          Its four parked ideas are still part of the plan a reader should see,
          so on a read-only board it renders without the picker rather than
          disappearing (UnscheduledRack drops it when `onAssign` is absent). */}
      {lensAcceptsDrops(lens) && (
        <div ref={rackWrapperRef} inert={preview.seq !== null ? true : undefined}>
          <UnscheduledRack
            items={rackItems}
            dayOptions={rackDayOptions}
            open={rack.open}
            onToggle={() => onRackEvent({ type: "toggle" })}
            onAssign={readOnly ? undefined : assignFromRack}
          />
        </div>
      )}
    </>
  );
}
