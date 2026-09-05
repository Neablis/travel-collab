"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useDaySync, useFocus } from "@/components/trip/context/FocusProvider";
import { useLens } from "@/components/trip/context/LensRouter";
import { chipModel, DayChips } from "@/components/trip/DayChips";
import { MapLens } from "@/components/lenses/MapLens";
import { ScheduleLens } from "@/components/lenses/ScheduleLens";
import { useIsPhone } from "@/components/lenses/useIsPhone";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { Button, buttonVariants } from "@/components/ui/button";
import { TripViewTabs } from "@/components/trip/TripViewTabs";
import { NotebooksMenu } from "@/components/trip/NotebooksMenu";
import { TagFocusLine } from "@/components/trip/TagFocusLine";
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
import type { AssistantTurn } from "@/components/assistant/Transcript";
import { useAskThread } from "@/components/assistant/useAskThread";
import { phoneAskContext } from "@/components/assistant/phoneAskContext";
import { suggestedQuestions } from "@/components/assistant/suggestedQuestions";
import {
  AI_NOT_ENTITLED_CODE,
  DEMO_TRIP_UNSUPPORTED_CODE,
  applyAssistantProposal,
  type ApiError,
  type AskScope,
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
  const { trip, activeTrip, status, error, dispatch, applyOutcome, preview, pending, readOnly } = useTrip();
  const { lens } = useLens();
  const { openEdit } = useEditor();
  // Task 4's FocusProvider is mounted around this whole tree (trips/[tripId]/
  // page.tsx), so this hook must run unconditionally before the early
  // returns below — the day chips (Task 8) below the tab strip both read and
  // set it.
  const { focusedDay, setFocusedDay, focusedTag, toggleFocusedTag } = useFocus();
  // The two day containers this screen owns, per the day-sync contract in
  // `FocusProvider`'s header. Taken here rather than inside `DayChips` and
  // `Board` because both of those are props-only by design — their own tests
  // render them with no provider — and because this screen is already where
  // every other piece of their focus wiring lives.
  const chipsSync = useDaySync("chips");
  const columnsSync = useDaySync("columns");
  // The rail's own "Hide"/re-show is real layout chrome now, not AI
  // behavior gated behind M9 — see AssistantRail.tsx's header comment.
  const assistant = useAssistantVisibility();
  // Which of SPEC §9/§23's presentations the assistant opens as. `AssistantRail`
  // is emphatic that the caller must not reach for `useIsPhone()` — it returns
  // `false` on the server and on the first client paint, so a JS-gated swap
  // paints the docked rail for a frame before correcting. That flash is real
  // wherever the panel can be on screen at first paint. It is not reachable
  // here, and the reason is `useAssistantVisibility` directly above:
  // `useState(false)`, with no restore from storage, no URL parameter and no
  // server prop, so `assistant.open` is false on EVERY first paint. The rail is
  // unmounted then. The only thing that opens it is a click, which cannot be
  // handled before hydration — and `useIsPhone`'s effect has run by then. So
  // the swap is decided strictly after the correction, never across it.
  //
  // A CSS breakpoint is what the rail's own docstring asks for and it is not
  // available at this seam anyway: `presentation` picks a geometry CLASS, so
  // choosing between two with media queries would mean mounting two rails —
  // two composers, two transcripts in the accessibility tree, and a
  // conversation whose draft depends on which copy you typed into.
  //
  // The hook also keeps this correct across a resize, which a
  // which-button-did-you-press flag would not: rotating a 411x852 phone into
  // landscape crosses 768px with the panel already open.
  const isPhone = useIsPhone();
  // The demo board (`/demo`, ADR-031) runs everything on this screen except
  // the assistant. Not because it would look wrong — because it would not
  // work: `/api/trips/:id/ask` refuses the demo trip outright with a 403
  // `demo-trip-unsupported` (KI-79), so a launcher offered to a signed-out
  // visitor has no outcome but an error. This is the one control on the board
  // with no read-only half to fall back to.
  const isDemo = isDemoTripId(tripId);
  // The conversation lives in `useAskThread` now — it is the same machinery a
  // notebook page needs (M14 link 8), and two copies would have meant two
  // thread ceilings and two definitions of "this turn was abandoned". What
  // stays here is what is genuinely the board's: the scope, the two refusals
  // below, and proposals.
  // `pending`, readable AFTER an await — where the render closure's copy is
  // stale by a whole AI batch round-trip (see `approveProposal`). Assigned
  // during render rather than in an effect, the same way TripProvider keeps
  // `optimisticRef` in step, so it is never a render behind. It must live up
  // here with the other hooks: everything below the `status` early returns
  // runs conditionally, and a `useRef` there is a hook-order violation.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // Scope, derived HERE rather than beside its first use further down, because
  // the hook below it is a hook: everything past the `status` early returns
  // runs conditionally, and calling `useAskThread` there is a hook-order
  // violation. `activeTrip` is null until the trip loads, and a scope with no
  // trip behind it is simply trip-scoped — the same "wider reading is the safer
  // one" call `parseAskScope` makes server-side for a scope line it cannot
  // parse, and unobservable in any case because the rail is not rendered yet.
  //
  // The clamp is real and was a bug: focusing the last day and then deleting it
  // left a scope pointing past the end, and every answer came back
  // `this trip has N days, so day N+1 is out of range` with no way back.
  const scopedDay =
    focusedDay !== null && activeTrip !== null && focusedDay < activeTrip.days.length ? focusedDay : null;
  // `dayIndex` is 0-based, matching TripDetail.days and /ask's scope; the day
  // NUMBER a human reads is +1, and that conversion happens in one place.
  const askScope: AskScope = scopedDay !== null ? { kind: "day", dayIndex: scopedDay } : { kind: "trip" };
  // The conversation itself. What the board still owns is the one event only it
  // can act on: a `proposal`, attached to the answer and still PENDING. Nothing
  // has been committed — the only thing that writes is `applyAssistantProposal`,
  // below, behind the Approve button.
  const ask = useAskThread({
    tripId,
    scope: askScope,
    errorMessage: askErrorMessage,
    onEvent: (event, patchAnswer) => {
      if (event.type !== "proposal") return;
      patchAnswer((turn) => ({
        ...turn,
        proposal: { proposal: event.proposal, status: "pending", note: null },
      }));
    },
  });
  const thread = ask.thread;
  // Collapsed by default (Phase 3's design). The open flag is paired with who
  // opened it, because a drag auto-opens the drawer and must only re-close the
  // ones it opened itself — that rule lives in `rackDisclosure` (a pure
  // reducer with its own unit tests), not here.
  const [rack, setRack] = useState<RackDisclosure>({ open: false, openedByDrag: false });
  const onRackEvent = (event: RackEvent) => setRack((state) => rackDisclosure(state, event));
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

  // THE focused day, clamped to a day that still exists — and the single
  // value the assistant's scope, its context line and its suggested questions
  // are all derived from below.
  //
  // `focusedDay` outlives the day it points at: FocusProvider holds a bare
  // index and nothing resets it when a day is removed. Before this clamp the
  // three consumers disagreed about what a stale index meant — the scope sent
  // it verbatim, the context line said "Looking at Day N" for a day that no
  // longer existed, and `suggestedQuestions` (correctly) read it as no focus
  // at all. The visible result of focusing the last day and then deleting it
  // was trip-shaped chips that every returned
  // `this trip has N days, so day N+1 is out of range`, with no way back.
  //
  // Clamping to `null` is the same "wider reading is the safer one" call
  // `parseAskScope` makes server-side for a scope line it cannot parse.
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
  // your trip — is worse than either. `composeAiPlan` has since been deleted
  // outright (ADR-033 Decision 4): the rail's judgement here is what left it
  // with no caller at all, and dead code was the only thing keeping it.
  //
  // M9 (Task 6) brought applying a plan back through THIS endpoint, in the
  // strictly better form: the turn PROPOSES, the user reviews, and Approve
  // commits one atomic batch through /ask/apply. See `approveProposal` below.
  //
  // Conversation state is client-held (Ruling R1): there is no conversations
  // table and no migration in this plan, so `thread` IS the conversation and
  // the whole of it is posted back on every turn. It survives hiding the rail
  // (this component stays mounted) and dies with the page, which is the
  // honest lifetime for something the server keeps nothing of.
  const submitAssistantAsk = async (text: string) => {
    // A viewer's ask is refused here even though /ask itself admits a viewer
    // (ASK_MINIMUM_ROLE) and writes nothing. Kept deliberately, and still a
    // product call about who the assistant is offered to rather than a
    // mechanical guard: with M9's write tools landed, the server already
    // offers a viewer's turn the READ tools only (`minimumRoleFor`, measured
    // from the set actually handed to the agent), and `/ask/apply` refuses
    // them outright — so a viewer could hold a safe read-only conversation.
    // Offering one is a product decision nobody has made; this refusal is
    // where to change it if it ever is.
    // Reported through the rail's own askError surface rather than swallowed —
    // a control that silently does nothing is the failure mode TripProvider's
    // runDispatch comment was written about.
    if (readOnly) {
      ask.refuse("You have view-only access to this trip.");
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
      ask.refuse("Finish saving your changes before asking the assistant.");
      // false keeps the rail's typed prompt on screen: this ask never reached
      // the model, so making the user retype it would read as a broken box.
      return false;
    }
    // Deliberately NOT awaited: the answer streams for seconds, and the rail
    // clears its composer on whatever this resolves to. Accepting the ask is
    // the thing the composer waits for; the answer arrives in `thread`.
    void ask.runAsk(text);
    return true;
  };

  // ---------------------------------------------------------------------
  // Propose -> review -> approve (M9)
  // ---------------------------------------------------------------------
  //
  // Why approving can be blocked, and why the reason is computed once here
  // rather than asked per card:
  //
  //   * **View-only.** A viewer's turn is never offered write tools
  //     (`handleAskRequest`), so they cannot hold a proposal — but a role can
  //     change under a mounted page, and a button that 403s is worse than one
  //     that says why.
  //   * **Unsent edits.** `applyOutcome` has a stated precondition: apply an
  //     outcome only when `pending` is empty, because the server decided it
  //     without seeing anything still queued here, so taking it discards those
  //     units from the UI and the server both (TripProvider's own comment,
  //     docs/reviews/2026-08-28-m11-pr71-review.md §4). The ask itself is
  //     already refused while `pending`; approving is a SECOND moment, minutes
  //     later, when a drag may have queued something since.
  const approvalBlockedReason = readOnly
    ? "You have view-only access to this trip."
    : pending
      ? "Finish saving your changes before applying this."
      : null;

  const patchProposal = (
    turnId: string,
    fn: (state: NonNullable<Extract<AssistantTurn, { role: "assistant" }>["proposal"]>) =>
      | NonNullable<Extract<AssistantTurn, { role: "assistant" }>["proposal"]>
      | null,
  ) =>
    ask.patchTurn(turnId, (t) =>
      t.role === "assistant" && t.proposal != null ? { ...t, proposal: fn(t.proposal) } : t,
    );

  const approveProposal = async (turnId: string) => {
    if (approvalBlockedReason !== null) return;
    const turn = thread.find((t) => t.id === turnId);
    if (!turn || turn.role !== "assistant" || turn.proposal == null) return;
    // Guards a double click and a re-approval of something already applied.
    if (turn.proposal.status === "applying" || turn.proposal.status === "applied") return;
    const { proposal } = turn.proposal;
    patchProposal(turnId, (state) => ({ ...state, status: "applying", note: null }));

    const result = await applyAssistantProposal(tripId, proposal);
    if (!result.ok) {
      // The batch is atomic (ADR-013), so a refusal means NOTHING applied —
      // the card goes back to pending and the user can try again or reject.
      patchProposal(turnId, (state) => ({ ...state, status: "failed", note: result.error.message }));
      return;
    }
    // **Re-checked after the await, not before it.**
    //
    // `applyOutcome` clears `pending` unconditionally, and its documented
    // precondition is that nothing is queued — the server decided this outcome
    // without seeing anything still in the local queue, so taking it discards
    // those units from the UI *and* from the server. The check above ran from a
    // render-time closure before a whole AI batch round-trip; an edit dragged
    // during that window would be silently lost. This is the same failure the
    // rail's "Finish saving your changes before asking the assistant" refusal
    // was written for (docs/reviews/2026-08-28-project-review.md §1.4), so it
    // is closed the same way rather than left as a known issue.
    //
    // Skipping `applyOutcome` is safe and self-healing, not a dropped result:
    // the batch really did commit, and the queued edit's own send confirms
    // against fresh server state (`confirmHead` in TripProvider), which already
    // contains it. So the stops arrive on the board a moment later, by the
    // ordinary path, with nothing lost either way.
    if (pendingRef.current) {
      patchProposal(turnId, (state) => ({
        ...state,
        status: "applied",
        note: `${result.value.message} It will appear on your board once your other unsaved changes have saved.`,
      }));
      return;
    }
    // Authoritative server state, taken whole, the same way an undo is.
    applyOutcome({ detail: result.value.detail, history: result.value.history });
    patchProposal(turnId, (state) => ({ ...state, status: "applied", note: result.value.message }));
  };

  // Rejecting sends nothing. There is no server-side draft to discard: the
  // turn's write tools collected into a proposal that lives in this array and
  // nowhere else, so "reject" is this array changing and the trip staying
  // byte-identical.
  const rejectProposal = (turnId: string) => {
    patchProposal(turnId, (state) =>
      state.status === "applied" ? state : { ...state, status: "rejected", note: null },
    );
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
  // actually asked in, so it is worded FROM `askScope` — which is worded from
  // `scopedDay` — rather than from a second reading of `focusedDay`.
  const assistantContextLine =
    askScope.kind === "day" ? `Looking at Day ${askScope.dayIndex + 1}` : `Looking at ${activeTrip.name}`;

  // Derived from the trip in front of the user, never canned — the rules and
  // the reasoning are in suggestedQuestions.ts. Recomputed per render because
  // it is a pure walk of the days and it MUST change when the focused day
  // does; memoising it on `activeTrip` identity would be the bug. Fed
  // `scopedDay`, the same value the scope carries, so a question can never be
  // offered in one scope and asked in another.
  const assistantSuggestions = suggestedQuestions(activeTrip, scopedDay);

  // The same three things again, derived for the PHONE sheet (SPEC §23). Not a
  // second set of rules: `phoneAskContext` is where "which phone tab, and is a
  // page open" becomes a scope, and this screen is two of its four surfaces —
  // Plan and Map, which §23 treats as one because they show the same day.
  //
  // Fed `scopedDay`, the clamped index `askScope` is built from, so the sheet's
  // first line and the scope actually posted cannot disagree — the bug the
  // "says so in the same words" test below pins. `phoneAskContext` clamps a
  // stale index the same way, so with a clamped one in hand the two agree by
  // construction and `askScope` stays the single value on the wire.
  //
  // What actually changes below the breakpoint is the CONTEXT LINE, and that is
  // §23's point rather than an incidental: "Looking at Day 2" names a position
  // in an array, while "Asking about Fri 26 · Kyoto" names the day the reader
  // can see, in the day rail's own words (`chipModel`). The quick asks are
  // literally `suggestedQuestions` either way, which is deliberate — see that
  // function's note in `phoneAskContext`.
  const phoneAsk = phoneAskContext(activeTrip, scopedDay, { tab: lens === "Map" ? "map" : "plan" });

  // How many more questions this thread has room for.
  //
  // `runAsk` posts the whole thread plus the new question, and the server
  // refuses a body over `MAX_ASK_MESSAGES` with a 400 (`handleAskRequest`).
  // Until this existed the rail had no idea: at message 41 every turn failed
  // with "a thread may hold at most 40 messages", the question rolled back into
  // a composer that still looked ready, and nothing said New conversation was
  // the only way out (final branch review, 2026-08-29, finding 2).
  //
  // Counted from the SAME filter `runAsk` applies when it builds `posted` — a
  // turn with no text is not on the wire — so the two cannot disagree about
  // what the server will see. Each answered question adds two messages, so
  // `(cap − posted + 1) / 2` is what is left: at 39 posted, one more question
  // fits (40) and none after it.

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
      <div
        className={cn(
          "flex items-start",
          !isDemo && assistant.open && "assistant-open",
          // `assistant-launcher` marks the row while the closed-state pill is
          // actually on screen — the same condition that renders it below.
          // The Map lens reserves canvas for it (globals.css), and keying that
          // off "not .assistant-open" was wrong on /demo, where the launcher
          // never renders at all and the reservation was pure empty gap
          // (CodeRabbit, PR #98).
          !isDemo && !assistant.open && "assistant-launcher",
        )}
      >
        {/* .trip-board-content (globals.css): gives lens content a bottom
            margin against the page, dropped via .full-bleed for the Map
            lens, which is deliberately full-bleed (same `isFullLens` this
            component already computes below). `min-w-0` lets this column
            actually shrink when the rail opens — flex items default to a
            min-width of their content's intrinsic width, which a
            horizontally-scrolling day-columns row would otherwise refuse to
            go below. */}
        <div
          className={cn("trip-board-content min-w-0 flex-1", isFullLens && "full-bleed")}
          // Named so a test can read the two measured custom properties below
          // off the element that publishes them. The lint wall rejects
          // `container.querySelector` (check-lint-wall.mjs), and this element
          // carries no role or accessible name to reach it by — it is a
          // styling seam, which is exactly the case `data-testid` is for here.
          data-testid="trip-board-content"
          // The rack is `position: fixed`, so it is outside normal flow and
          // reserves no space: the day columns' own 24px bottom padding was
          // measured against the viewport, not against the bar sitting on
          // top of it, and a card's bottom edge ended up flush under the
          // "Unscheduled" bar (Mitchell, 2026-08-30 design pass). Feeding the
          // already-measured rack height in as a custom property lets
          // `.trip-board-content` keep its 24px gap *above the bar* instead,
          // and it tracks the rack opening, closing and changing item count
          // for free — the same measurement the assistant launcher's `bottom`
          // offset reads.
          // There WAS a second property here, `--launcher-height`, measured
          // the same way and spent by MapLens's canvas. It is gone with the
          // thing it measured: the assistant's phone entry point is now the
          // header's Ask pill (SPEC §23), so the launcher below is a
          // `position: fixed` desktop pill and nothing else — flow footprint
          // zero at every width, by construction rather than by measurement.
          // A variable that can only ever publish `0px` is not a smaller
          // version of this one; it is a reader-facing claim that something is
          // still being measured.
          // eslint-disable-next-line no-restricted-syntax -- a measured, changing pixel height cannot be a static token
          style={{ "--rack-height": `${rackHeight}px` } as React.CSSProperties}
        >
          {/* The phone's Ask pill lives in this header's top row (SPEC §23),
              but the assistant's visibility belongs here — the rail is this
              screen's child and the thread is this screen's state. So the flag
              and the opener are passed down rather than the state moving up.
              `undefined` on /demo withholds the pill outright, the same
              condition that renders no launcher below: `/api/trips/:id/ask`
              refuses the demo trip (KI-79), so there is nothing for it to
              open. */}
          <TripHeader
            tripId={tripId}
            assistantOpen={assistant.open}
            onOpenAssistant={isDemo ? undefined : assistant.show}
          >
            {/* "Beside the view tabs" (SPEC §11), so one row — and the design
                keeps it one row at every width by SCROLLING it
                (`flex-wrap: nowrap; overflow-x: auto`), not by wrapping. The
                build wrapped, so on a phone the Notebooks pill dropped onto a
                second line and pushed the day chips down; nothing here is
                worth a row of its own. */}
            <div className="flex flex-nowrap items-center gap-4 overflow-x-auto">
              {/* `shrink-0` on the wrapper, not inside TabStrip: TabStrip is a
                  primitive with no className seam, and under `nowrap` an
                  unpinned child squeezes instead of scrolling — which is the
                  failure mode this row is being changed to avoid. */}
              {/* `hidden md:block` — SPEC §10's "two views, not four" on the
                  phone. Below 768px Plan and Map are PhoneTabBar's tabs, and
                  the two views this strip adds (Day columns, Calendar) are the
                  two §10 removes, so the whole strip is a duplicate of the tab
                  bar plus two entries that must not be reachable. It was also
                  actively breaking this row: four 26px tabs overflow a 390px
                  screen far enough that the "Notebooks" pill beside them sat
                  106px past the right edge.

                  `display: none` on the wrapper, not `return null` inside
                  TripViewTabs: the component still mounts, which is what keeps
                  `usePhoneTwoViews` (its URL normalisation — see that hook)
                  running on exactly the screens that need it. */}
              <div className="hidden shrink-0 md:block">
                <TripViewTabs />
              </div>
              {/* Deliberately NOT wrapped in a `shrink-0` div the way the tabs
                  are, though the design pins it `flex: 0 0 auto`: TagFocusLine
                  renders null when no tag is focused and a wrapper does not, so
                  the wrapper would leave a phantom flex item — and a `gap-4`
                  worth of dead space — on every board that is not focused. It
                  carries its own `min-w-0` and truncate for the squeeze. */}
              <TagFocusLine />
              {/* The design's explicit spacer, in place of `ml-auto` on the
                  pill: the focus line appears and disappears between the tabs
                  and the pill, and a margin-auto would drag the pill leftwards
                  whenever a tag came into focus. `min-w-3` is the design's
                  12px floor, so the two never touch once the row is scrolling. */}
              <div className="min-w-3 flex-auto" />
              {/* SPEC §11: the Notebooks pill sits at the FAR RIGHT of this
                  row, deliberately a different class of thing from the tabs —
                  they project this trip through another view, it leaves for
                  another route.

                  Gated on `isDemoTripId` for the same reason `TripHeader`'s nav
                  row is (ADR-031): the demo board's visitor has no session, so
                  every notebook route behind it is a trip to /signin. A control
                  that only leads to a sign-in wall still says "there is
                  something here for you", and there is not. */}
              {/* `hidden md:block`: on a phone the bottom tab bar carries
                  Notebook (SPEC §16), and its destination is this pill's own —
                  the notebook index, which lists exactly what the pill's menu
                  lists. Two controls for one route in one screen is RULES.md
                  rule 4, the same reason `AccountMenu`'s Trips/Playbooks links
                  step aside below 768px. It also removes a real defect rather
                  than only a duplicate: this pill is the last item in a
                  horizontally scrolling row, and at 390px it rendered 106px
                  PAST the right edge with no scroll affordance, so the phone's
                  only route to the Notebook was one nobody could see. */}
              {!isDemo && (
                <div className="hidden shrink-0 md:block">
                  <NotebooksMenu tripId={tripId} readOnly={readOnly} />
                </div>
              )}
            </div>
            {/* Task 2.3: MapRail replaces the chips row's job in map view — the
                two side by side would be redundant, and the chips row's own
                horizontal scroll makes no sense floating over a full-bleed map. */}
            {lens !== "Map" && (
              <DayChips
                days={chipModel(activeTrip)}
                focusedDay={focusedDay}
                // Named so the chips row knows a day was picked HERE rather
                // than handed to it — which is what lets its own scroll spy be
                // held off a pick it cannot centre. See `jumpTo`.
                onSelect={(index) => setFocusedDay(index, "chips")}
                readOnly={readOnly}
                sync={chipsSync}
              />
            )}
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
                    // Focus is a view state, not a command, so it is threaded
                    // past the read-only gate deliberately: a viewer's board
                    // and `/demo`'s signed-out reader both get the whole
                    // behaviour. Nothing here reaches `dispatch`.
                    focusedTag={focusedTag}
                    onToggleTag={toggleFocusedTag}
                    // Scrolling the columns moves the header's selected day
                    // too (Mitchell, 2026-09-01), but as a reading position
                    // rather than a pick — and a day picked anywhere else
                    // scrolls its column into view here. See the day-sync
                    // contract in `FocusProvider`.
                    sync={columnsSync}
                    callbacks={{
                      // "columns", for the same reason the chips row names
                      // itself above: at any width where more than about two
                      // columns fit, the first and last day can never sit on
                      // this row's centre reading line, so clicking their
                      // header must not be undone by this row's own spy.
                      onSelectDay: (index: number | null) => setFocusedDay(index, "columns"),
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
          {!isDemo && !assistant.open && (
            // The closed-rail launcher — DESKTOP ONLY as of SPEC §23. It used
            // to have two presentations, split at the same 768px the rail
            // itself turns on; the phone half is gone, because §23 gives the
            // phone a permanent entry point instead of a launcher that only
            // exists while the assistant is closed: the `Ask` pill in the trip
            // header's top row (`AskPill`, mounted by `TripHeader` above).
            //
            // What the phone half WAS, and why deleting it is not a regression
            // against the issue that produced it: KI-2026-08-30 moved this
            // control out of the viewport's bottom-right and into normal flow
            // as a full-width button at the end of the plan column, because
            // SPEC §13.5 is categorical — "Nothing floats over data. No
            // floating action button." — and this pill had been sitting on top
            // of right-aligned stop costs at 402x874. The header pill honours
            // §13.5 harder than the in-flow button did: it is in the header's
            // own normal flow, above the data rather than after it, and it does
            // not disappear the moment the assistant opens. Two entry points to
            // the same panel on one 411px screen is what §23 removes.
            //
            // >=768px is unchanged: the design's minimized launcher
            // (`Trip Planner Redesign.dc.html:1058-1063`), a filled-brand pill
            // pinned bottom-right by `position: fixed`, not the edge-tab
            // treatment this used to have (variant="secondary",
            // rounded-r-none, vertically centred against the right edge) — the
            // design has no bordered edge-tab state for the assistant, only
            // this pill. Icon mirrors AssistantRail's own open-state mark
            // glyph (◎, same component's header).
            //
            // `hidden md:inline-flex` on the Button itself, and the `flow-root`
            // wrapper, the `PageContainer` and the measured `--launcher-height`
            // that went with them are all gone. They existed for the in-flow
            // presentation only: the wrapper was a block formatting context so
            // the button's own top margin could be MEASURED as flow footprint,
            // and the measurement was published for MapLens to subtract from a
            // canvas sized to the whole viewport. A `position: fixed` element
            // costs no flow space, so with the phone half removed that whole
            // chain measures a constant zero and is deleted rather than left
            // publishing one.
            //
            // Still deliberately outside the `inert` wrapper above (as before):
            // asking a question about a previewed history state is a read, not
            // a write, so it stays available while the board is inert.
            <Button
              variant="primary"
              onClick={assistant.show}
              className="fixed right-6 z-40 hidden h-auto gap-2 rounded-full px-4 py-2.5 text-base font-semibold shadow-overlay md:inline-flex"
              // Only read while the pill is `position: fixed`, which is now the
              // only way it is ever rendered.
              // eslint-disable-next-line no-restricted-syntax -- bottom offset clears the unscheduled rack's own measured height (see rackHeight above), which changes with its open state and item count — not expressible as a static token.
              style={{ bottom: rackHeight > 0 ? rackHeight + 24 : 24 }}
            >
              <span aria-hidden>◎</span>
              Assistant
            </Button>
          )}
        </div>
        {/* The assistant rail — a real streaming conversation against
            /api/trips/:id/ask (see runAsk above). Mounted here, as the row's
            second flex child, so it's present regardless of which lens is
            active and its 356px width comes out of real layout (see the row's
            own comment above) rather than a fixed-position overlay. Unmounted
            entirely (not just visually hidden) when the user hides it, so it
            costs the row nothing when closed — the thread lives in this
            component, so hiding the rail does not end the conversation.

            Below 768px it is not a rail at all but SPEC §23's bottom SHEET,
            which brings its own scrim and takes itself out of this row with
            `position: fixed` (`.assistant-sheet`, globals.css). The scrim has
            to paint over the phone tab bar — DRIFT.md build-check 4c, because
            switching tabs behind an open sheet changes its scope halfway
            through the conversation — and it can, from here: this row, the
            `.trip-board-content` wrapper, `PageContainer` and
            `.phone-tab-bar-inset` are all plain static boxes with no
            `transform`, `filter`, `contain`, `will-change` or positioned
            z-index between them and <body>, so nothing traps a fixed
            descendant in a stacking or containing block of its own. Checked
            deliberately rather than assumed, and pinned by the
            "tabs are not tappable behind an open sheet" e2e test. */}
        {!isDemo && assistant.open && (
          <AssistantRail
            presentation={isPhone ? "sheet" : "docked"}
            contextLine={isPhone ? phoneAsk.contextLine : assistantContextLine}
            scope={askScope}
            turns={thread}
            suggestions={isPhone ? phoneAsk.quickAsks : assistantSuggestions}
            // Undefined on the desktop, which leaves the rail's own trip-wide
            // sentence — §23 changes the phone and nothing above 768px.
            emptyHint={isPhone ? phoneAsk.emptyHint : undefined}
            asksRemaining={ask.asksRemaining}
            restoreDraft={ask.restoredDraft}
            onNewConversation={ask.startNewConversation}
            onAsk={(text) => submitAssistantAsk(text)}
            onApproveProposal={(turnId) => void approveProposal(turnId)}
            onRejectProposal={rejectProposal}
            approvalBlockedReason={approvalBlockedReason}
            asking={ask.asking}
            askError={ask.askError}
            simulated={ask.simulated}
            onHide={assistant.hide}
          />
        )}
      </div>
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
