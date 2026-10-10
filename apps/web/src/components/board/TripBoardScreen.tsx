"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { TimeWindow } from "@tc/contracts";
import { useTrip } from "@/components/trip/context/TripProvider";
import { useEditor } from "@/components/trip/context/EditorHost";
import { useDaySync, useFocus } from "@/components/trip/context/FocusProvider";
import { lensCommands, moveStopsCommands, newStopCommand } from "@/components/palette/commands";
import { usePaletteSource } from "@/components/palette/paletteRegistry";
import { newStopPrefill } from "@/components/trip/newStopPrefill";
import { useLens } from "@/components/trip/context/LensRouter";
import { chipModel, cityFor } from "@/lib/dayChips";
import { DayChips } from "@/components/trip/DayChips";
import { MapLens } from "@/components/lenses/MapLens";
import { CalendarLens } from "@/components/lenses/CalendarLens";
import { OverviewLens } from "@/components/lenses/OverviewLens";
import { useIsAbovePhone, useIsPhone, useIsTabletWidth } from "@/lib/useIsPhone";
import { Heading } from "@/components/ui/heading";
import { Text } from "@/components/ui/text";
import { buttonVariants } from "@/components/ui/button";
import { TripViewTabs } from "@/components/trip/TripViewTabs";
import { NotebooksMenu } from "@/components/trip/NotebooksMenu";
import { TagFocusLine } from "@/components/trip/TagFocusLine";
import { PageContainer } from "@/components/ui/page-container";
import { TripHeader } from "@/components/trip/TripHeader";
import { TripHeaderSkeleton } from "@/components/trip/TripHeaderSkeleton";
import { useTripCover } from "@/components/trip/cover/useTripCover";
import { usePhoneAskEntry } from "@/components/nav/phoneAsk";
import { AddSavedDayButton } from "@/components/trip/AddSavedDayButton";
import { useBoardSuggestions } from "./SuggestionActions";
import { SuggestionTray } from "./SuggestionTray";
import { ActivityEditorSheet } from "@/components/trip/editor/ActivityEditorSheet";
import { PeopleProvider } from "@/components/pages/people";
import { type RackItem, UnscheduledRack } from "@/components/trip/UnscheduledRack";
import { moveCommands } from "./moveCommands";
import { copyActivityCommand } from "./copyActivity";
import type { resolveCalendarDrop } from "@/components/lenses/calendarDrop";

type CalendarDropOutcome = NonNullable<ReturnType<typeof resolveCalendarDrop>>;
import { rackDropWindow } from "./rackDropWindow";
import { kindBadge } from "./activityKind";
import { type AnyTimeOutcome, anyTimeCommands, type DropOutcome, type PlaceOutcome, placeCommands } from "./resolveDrop";
import { lensAcceptsDrops } from "./lensAcceptsDrops";
import { rackDisclosure, type RackDisclosure, type RackEvent } from "@/components/trip/rackDisclosure";
import { legRoute, shortPlace } from "@/lib/place";
import { isDemoTripId } from "@/lib/demoTrip";
import { useAssistantShape } from "@/components/assistant/useAssistantShape";
import { AssistantRail } from "@/components/assistant/AssistantRail";
import type { AssistantTurn } from "@/components/assistant/Transcript";
import { proposalUndoFor, type ProposalState } from "@/components/assistant/ProposalCard";
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
import { Board } from "./Board";
import { ConflictsChip } from "./ConflictsChip";
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
  // **Falls through to the server's own words since M20 link 4.** This used to
  // rewrite the refusal as *"The assistant is switched off for this account"*,
  // which was true when nothing could be entitled and is now a permission error
  // where the server sent a 402 naming a tier. The server owns this sentence
  // (`AI_NOT_ENTITLED_REASON`) precisely so the rail, the endpoint and the test
  // cannot tell three different stories about the same refusal; what the rail
  // still decides is how it is PRESENTED, which is `askUpgrade` below.
  if (error.code === AI_NOT_ENTITLED_CODE) return error.message;
  return error.message;
}

function useAssistantVisibility() {
  const [open, setOpen] = useState(false);
  return { open, show: () => setOpen(true), hide: () => setOpen(false) };
}

export function TripBoardScreen({ tripId }: { tripId: string }) {
  const { trip, activeTrip, history, status, error, dispatch, dispatchBatch, applyOutcome, preview, pending, readOnly, myRole, canEditBoard, boardMode, draft, remoteRevision, confirmedSeq, suggestions: tripSuggestions } = useTrip();
  // Read by the assistant's `onEvent` when a turn's changes were stored as
  // suggestions; a ref so the handler never holds a render-old list.
  const refreshSuggestions = useRef(tripSuggestions?.refresh);
  refreshSuggestions.current = tripSuggestions?.refresh;
  const { view, setView } = useLens();
  const { openCreate, openEdit } = useEditor();
  const suggestions = useBoardSuggestions();
  // Task 4's FocusProvider is mounted around this whole tree (trips/[tripId]/
  // page.tsx), so this hook must run unconditionally before the early
  // returns below — the day chips (Task 8) above Plan's columns both read and
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
  // The phone's way in is the tab bar's Ask item (Mitchell, 2026-10-10), which
  // lives in the layout, outside this tree: offer it the same opener the
  // header's desktop pill gets. Withheld on /demo for the pill's reason (KI-79).
  //
  // **Only once the board itself renders** (PR #384 review). This hook has to
  // sit above the loading, signed-out and error returns below, but the
  // `AssistantRail` it opens sits after them — so registering unconditionally
  // gave a phone an Ask item on the skeleton, the sign-in prompt and the error
  // that opened nothing. The condition is the one those returns test.
  //
  // **The header waits for the cover read, from 768px up** (PR #384 review).
  // `TripHeader` draws the cover band above itself once the cover is known;
  // when that read answered after the header had painted, the band pushed the
  // whole board down 112px — a layout shift on every trip with a cover. Of the
  // ways out, holding the skeleton is the one that never shifts: reserving the
  // band's height only helps when a cover is already cached, and reserving it
  // always leaves a gap that collapses on every trip without one. The read
  // runs alongside `TripProvider`'s own, a failed one settles too (no band),
  // and a phone never reads it, so the cost is the slower of two parallel
  // reads, on desktop only. `undefined` from `useIsAbovePhone` is hydration,
  // when the trip is still loading anyway.
  const abovePhone = useIsAbovePhone();
  const { settled: coverSettled } = useTripCover(tripId, abovePhone === true && !isDemoTripId(tripId));
  const headerReady = abovePhone !== undefined && coverSettled;
  const boardRenders = status === "ready" && trip !== null && activeTrip !== null && headerReady;
  usePhoneAskEntry(boardRenders && !isDemoTripId(tripId) ? assistant.show : undefined, assistant.open);
  // **⌘K's lenses and *New stop*** (M41 D9, ADR-068): the lens switcher's
  // own `setView`, and the editor opened on the selected day with a fitted
  // time (`newStopPrefill`, what a paste onto a day opens), else parked. The
  // assistant needs nothing here: the palette offers the opener registered
  // just above, the one the phone's tab bar uses.
  const focusedDayId = focusedDay === null ? undefined : activeTrip?.days[focusedDay]?.dayId;
  // A day's header dropped on another day (M41 D7): its stops move there as one
  // batch, through the move every other drop builds (ADR-068 §3). Times kept.
  // Up here, above the early returns, because ⌘K's *Move Day N's stops*
  // below is this same function (PR 395 review: a day moved only by a drag).
  const moveDay = (fromDayId: string, toDayId: string) => {
    const from = activeTrip?.days.find((d) => d.dayId === fromDayId);
    if (activeTrip == null || from === undefined) return;
    const commands = moveCommands(activeTrip, from.activityIds, toDayId);
    if (commands.length > 0) void dispatchBatch(commands);
  };
  const dayToMove = canEditBoard && focusedDay !== null ? activeTrip?.days[focusedDay] : undefined;
  usePaletteSource(
    "trip-board",
    boardRenders && activeTrip !== null
      ? [
          ...lensCommands(setView),
          ...(canEditBoard ? [newStopCommand(() => openCreate(newStopPrefill(activeTrip, focusedDayId)))] : []),
          ...(dayToMove !== undefined && dayToMove.activityIds.length > 0
            ? moveStopsCommands(
                { id: `day:${dayToMove.dayId}`, name: `Day ${activeTrip.days.indexOf(dayToMove) + 1}'s stops` },
                activeTrip.days.flatMap((day, index) => (day.dayId === dayToMove.dayId ? [] : [{ key: day.dayId, label: `Day ${index + 1}` }])),
                (toDayId) => moveDay(dayToMove.dayId, toDayId),
              )
            : []),
        ]
      : [],
  );
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
  // SPEC §9's "and the user picks" (M26 link 10a). Per surface and per
  // device — see `useAssistantShape` for why neither is one global setting.
  const [assistantShape, chooseAssistantShape] = useAssistantShape("board");
  // **From 768 to 1099px the board keeps its width and Ask comes up over it**,
  // whatever the reader chose (M39 D3; Mitchell, 2026-10-09: "the band
  // wins"). Docked at 820px left the board about 440px, one and a half day
  // columns (KI-2026-09-24-j); the sheet costs it nothing. The reader's choice
  // is honoured from 1100px up, and is not offered where it cannot be.
  // Decided after the first paint by the same argument as `isPhone` above.
  const isTabletWidth = useIsTabletWidth();
  const assistantPresentation = isPhone || isTabletWidth ? "sheet" : assistantShape;

  /**
   * Arriving at the phone's plan with nothing selected picks the first day.
   *
   * SPEC §23's sheet inherits the surface's scope, and on arrival there was no
   * scope to inherit. Measured at 412×855 on the seeded 14-day trip
   * (2026-09-05): the day rail rendered fourteen chips with none of them
   * current, so `focusedDay` was null and the first tap of `Ask` opened on
   * "Asking about [Seed] Japan: Tokyo → Kyoto → Osaka" with "Ask about this
   * trip…" — the trip-wide default a tab was rejected for (`phoneAskContext`'s
   * header). Tapping any chip already produced the right thing, so the
   * derivation was never wrong; only the arrival default was.
   *
   * **Day 1, always.** Mitchell chose the fully predictable rule over "today's
   * day if the trip is in progress", so there is deliberately no date
   * arithmetic here: a trip you are on day 6 of still opens on day 1.
   *
   * Phone only, and the gate is the load-bearing part. Above the breakpoint
   * the timeline's scroll spy owns `focusedDay` and a null start is right
   * there — nobody has chosen a day, and the rail says so until they scroll
   * past one. Defaulting inside `FocusProvider` would have applied this to
   * every surface at every width (the demo board, the notebook, the desktop
   * timeline) for a rule that is about one screen.
   *
   * Explicit, and named to no container — the same shape as `MapLens`'s own
   * arrival default. *Explicit* is the honest origin (nobody scrolled) and is
   * what makes a lens switch land on this day; *no container* leaves every day
   * container a plain follower, so `jumpTo` releases its lock on a jump that
   * moves nothing and the reader's first flick is not swallowed
   * (`keepLockIfUnmoved` in `useDaySync` names this exact case).
   *
   * It does not carry the reader down their plan, which would be worse than the
   * bug it fixes: the timeline follows with `block: "center"`, so a default
   * aimed anywhere but the top lands you mid-trip — measured on the seeded
   * three-day trip, defaulting to day 3 settles at `scrollY` 1002 of a 2348px
   * document. Day 1's header is above the centre line, so that jump clamps.
   * Not literally motionless, though, and the honest number is worth keeping:
   * the focused day draws a suggestion card and the page settles 42px down.
   * That 42px belongs to focusing day 1 rather than to doing it on arrival —
   * with no default at all a reader tapping that chip lands on the same
   * 42/2348, identically under both `FocusOrigin`s, which is why the origin
   * above was chosen on its merits and not to buy a scroll back.
   * `e2e/m16-mobile-assistant.spec.ts` pins the property, not the pixel.
   *
   * Once per mount. Re-tapping the focused chip clears the focus (`DayChips` —
   * the whole chip is the toggle), and that is the phone's only way back to
   * trip scope; a latch is what keeps this effect from immediately undoing it.
   *
   * `useIsPhone` is false on the server and on the first client paint, so this
   * lands one tick later — no ring, then day 1. Harmless, and not a hydration
   * mismatch: the pre-correction state is not a *wrong* state, it is the state
   * this screen shipped with, and the server and first client render agree on
   * it. Nothing can observe the gap either, for the same reason the
   * `presentation` swap below cannot — the scope is read when the pill is
   * clicked, and a click cannot be handled before hydration, by which time
   * `useIsPhone`'s effect has run.
   */
  const defaultedPhoneDay = useRef(false);
  useEffect(() => {
    if (!isPhone || defaultedPhoneDay.current) return;
    if (focusedDay !== null || activeTrip === null || activeTrip.days.length === 0) return;
    defaultedPhoneDay.current = true;
    setFocusedDay(0);
  }, [isPhone, focusedDay, activeTrip, setFocusedDay]);

  const searchParams = useSearchParams();
  /** **A link card to a notebook** from a board with no notebook route — `/demo`, an invite's look (`linkHref`). */
  const linkedPage = searchParams.get("page");
  /**
   * **A link card to a day** (M30, ADR-056) arrives as `?view=Plan&day=<dayId>`:
   * the day is focused once the trip is here, and Plan's own day-sync scrolls
   * to it. By id, so a link made before days were reordered still lands on its
   * day. Once per value, so clearing the focus afterwards is not undone.
   */
  const linkedDay = searchParams.get("day");
  const appliedDayLink = useRef<string | null>(null);
  useEffect(() => {
    if (linkedDay === null || activeTrip === null || appliedDayLink.current === linkedDay) return;
    appliedDayLink.current = linkedDay;
    const index = activeTrip.days.findIndex((day) => day.dayId === linkedDay);
    if (index !== -1) setFocusedDay(index);
  }, [linkedDay, activeTrip, setFocusedDay]);

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
  //
  // **A phone on Overview or Calendar asks about the trip** (SPEC §24 scopes
  // both to it; KI-2026-09-25-f). The focus survives onto them and the sheet
  // states the surface's scope (§23), so the wire has to drop the day too or
  // the line and the turn disagree. Phone only: above 768px the rail's own
  // "Looking at Day N" scope is unchanged.
  const tripWideOnPhone = isPhone && (view === "Overview" || view === "Calendar");
  const scopedDay =
    !tripWideOnPhone && focusedDay !== null && activeTrip !== null && focusedDay < activeTrip.days.length
      ? focusedDay
      : null;
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
    // **The conversation survives a reload** (M9 design §6). Named per TRIP,
    // because that is what this rail's conversation is about — a notebook page
    // on the same trip mounts its own hook and gets its own name, which is why
    // the hook takes the name rather than deriving one from `tripId`.
    //
    // `localStorage`, so it does not survive a device change or cleared site
    // data. That is the honest lifetime for a working surface, and the reason
    // the restored transcript carries no Approve button: `askThreadStore`
    // drops the proposal, keeping the prose that made the answer readable.
    persistAs: `trip:${tripId}`,
    // ADR-067: a turn may have stored suggestions. Re-read the list when it
    // ends — answered, failed or stopped, announced or not — rather than on
    // the poll's next revision, which a solo trip never runs (W73).
    onTurnEnd: () => void refreshSuggestions.current?.(),
    onEvent: (event, patchAnswer) => {
      if (event.type === "suggested") {
        patchAnswer((turn) => ({ ...turn, suggested: event.suggested }));
        return;
      }
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
  // The day whose group a column's "Unscheduled" chip last asked the rack to
  // show (PR #269). `seq` so a second click on the same chip reveals again —
  // after the reader has scrolled the rack elsewhere, say.
  const [rackReveal, setRackReveal] = useState<{ dayId: string; seq: number } | null>(null);
  const revealAnyTime = (dayId: string) => {
    setRackReveal((prev) => ({ dayId, seq: (prev?.seq ?? 0) + 1 }));
    onRackEvent({ type: "reveal" });
  };
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
  // the open/collapsed toggle and the item count changing. (That launcher is
  // gone since M39 D3 — Ask is in the trip header at every width — and the
  // measurement now feeds `--rack-height` alone.)
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
    // `border-box`: the rack's bottom safe-area inset is padding (M39 Part
    // 7), and the default content box does not change when only the inset
    // does — a rotation, say — so `--rack-height` would keep the old number.
    // `getBoundingClientRect` already reports the border box.
    const observer = new ResizeObserver(() => setRackHeight(el.getBoundingClientRect().height));
    observer.observe(el, { box: "border-box" });
    rackObserverRef.current = observer;
  }, []);
  useEffect(() => () => rackObserverRef.current?.disconnect(), []);

  // The page shell (trips/[tripId]/page.tsx) now owns the <main> landmark via
  // PageContainer as="main" width="full" px-0 (Task L1) — this component owns
  // its own horizontal padding via PageContainer wrappers below, so these
  // early-return states need their own too.
  // **The header's shape, and nothing else**, while the trip is in flight.
  //
  // It used to render `Loading…`, and on the common path — Home's hero has
  // usually already cached this `TripDetail` (`TripProvider.tsx:109`) — that
  // painted for about one frame. Mitchell, 2026-09-20: *"just never do the
  // 'Loading', gate the preview behind a network request to get the data not
  // having returned, dont even have the loading state. KEep it simple."*
  // `scripts/check-loading-wall.mjs` keeps the word from coming back anywhere
  // (KI-2026-09-20-e).
  //
  // That left `null`, and on a cold load the header then arrived in one jump
  // with the board. Mitchell, Vercel Toolbar on the trip preview: *"Header
  // doesnt have a skeleton element on page loading"*. The header is the one
  // region whose shape does not depend on the trip, so it is drawn at its real
  // height (`TripHeaderSkeleton`) in the same `.trip-board-content` column;
  // the body below still waits for its data, as before.
  if (status === "loading" || (status === "ready" && !headerReady)) {
    return (
      <div className="flex items-start">
        <div className="trip-board-content min-w-0 flex-1">
          <TripHeaderSkeleton tripId={tripId} />
        </div>
      </div>
    );
  }
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
  // The unscheduled rack's contents: trip.backlog is the source of truth for
  // "parked", and each id resolves through activities. The card's `area` slot
  // is `shortPlace()` — the same area-then-city-then-name-segment order the
  // timeline's place line uses. It used to inline `city ?? name`, which put
  // the venue's own name ("Ugly Duck Coffee") in a slot that means
  // "whereabouts": KI-35's exact defect, at a call site that entry never
  // named. Now that Location carries a real `area`, the helper is what fills
  // it honestly, and the rack agrees with every other place line in the app.
  // A transit leg with a destination fills the slot with both ends instead
  // ("Taipei → Tainan", `legRoute()`; Mitchell, 2026-09-30, option "B"): its
  // mode is already the card's badge, and where it goes was nowhere.
  // A backlog id with no matching activity is dropped rather than rendered as
  // a blank card.
  //
  // **Then every day's untimed stops, day by day** (PR #269). Mitchell, on the
  // board's "Any time" shelf: *"Maybe anything without a time is in
  // unscheduled?"*, then *"not sure how we should show the date ownership
  // still in the unscheduled rack"*. Only where they are drawn changes — each
  // keeps its day in the trip — so each carries that day: `Day N` as the
  // card's tag, and `Day N · City` over its group, in the §35.7 form the
  // Keep-a-day picker and the map's hover card already use, with the city
  // from the same `cityFor` the day chips read.
  const rackItem = (activityId: string, day: RackItem["day"]): RackItem[] => {
    const activity = activeTrip.activities[activityId];
    if (activity === undefined) return [];
    // M41 D6: the day a parked stop left, named by its place in the trip now.
    // `parkedFrom` holds parked stops only, and only when their move named a
    // day, so every other card gets none.
    const fromIndex = activeTrip.days.findIndex((d) => d.dayId === activeTrip.parkedFrom?.[activityId]);
    return [
      {
        activityId,
        title: activity.title,
        area: legRoute(activity) ?? shortPlace(activity.location),
        timeWindow: activity.timeWindow,
        bookedBy: activity.bookedBy,
        day,
        from: fromIndex === -1 ? null : `Day ${fromIndex + 1}`,
        badge: kindBadge(activity),
      },
    ];
  };
  const rackItems = [
    ...activeTrip.backlog.flatMap((activityId) => rackItem(activityId, null)),
    ...activeTrip.days.flatMap((day, index) => {
      const city = cityFor(day, activeTrip.activities);
      const tag = `Day ${index + 1}`;
      const owner = { dayId: day.dayId, tag, heading: city === null ? tag : `${tag} · ${city}` };
      return day.activityIds
        .filter((activityId) => !activeTrip.activities[activityId]?.timeWindow)
        .flatMap((activityId) => rackItem(activityId, owner));
    }),
  ];
  // Dragging a parked stop onto a day is the same two-command job the rack's
  // *Add to day…* did (gone in M41: the editor's Day field is its non-drag
  // path, `editActivityCommands`) — MoveActivity, then a real time — but the
  // drag knows something the day dropdown didn't: WHERE in the day you dropped it
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
  // MoveActivity, then a real time.
  // The decision of WHICH time — and whether to set one at all — is
  // rackDropWindow, a pure function so it can be tested without a drag
  // (rackDropWindow.ts explains why, and carries the reasoning that used to
  // live here). `activeTrip` is read before the dispatch on purpose: the move
  // is applied optimistically and empties the backlog the decision reads.
  const moveActivity = (activityId: string, toDayId: string | null, position: number) => {
    const timeWindow = rackDropWindow(activeTrip, activityId, toDayId, position);
    for (const move of moveCommands(activeTrip, [activityId], toDayId, { position })) void dispatch(move);
    if (timeWindow !== null) void dispatch({ type: "UpdateActivity", tripId, activityId, timeWindow });
  };

  // A drop in the Calendar (M41 D2), through the moves Plan's drops use.
  // A city card's stops move as ONE batch, one History entry and one undo,
  // and a drop past the trip's end adds its days in the same batch, so the
  // move and the days it needed are undone together. Timed stops keep their
  // times. A rack card is one stop, and lands the way it does on Plan.
  const calendarDrop = (outcome: CalendarDropOutcome) => {
    if (outcome.kind === "rack") {
      const day = activeTrip.days.find((d) => d.dayId === outcome.toDayId);
      moveActivity(outcome.activityId, outcome.toDayId, day?.activityIds.length ?? 0);
      return;
    }
    const newDayIds = Array.from({ length: outcome.newDays }, () => crypto.randomUUID());
    const toDayId = outcome.toDayId ?? newDayIds.at(-1)!;
    const commands = moveCommands(activeTrip, outcome.activityIds, toDayId, { newDayIds });
    if (commands.length > 0) void dispatchBatch(commands);
  };

  // A stop dropped with Option/Alt held (M41 D7): a copy lands where the drop
  // would have moved it. A drop on a river names the time; anywhere else the
  // copy keeps the stop's own, and on the rack it has none.
  const copyActivity = (outcome: DropOutcome) => {
    const to =
      outcome.kind === "unschedule"
        ? { dayId: null, timeWindow: null }
        : outcome.kind === "place"
          ? { dayId: outcome.toDayId, timeWindow: outcome.timeWindow ?? undefined }
          : outcome.kind === "anyTime"
            ? { dayId: outcome.toDayId, timeWindow: null }
            : { dayId: outcome.toDayId };
    const command = copyActivityCommand(activeTrip, outcome.activityId, crypto.randomUUID(), to);
    if (command !== null) void dispatch(command);
  };

  // A drop at a time on a day's river (M29 part 3): the day AND the time, as
  // ONE batch, so one undo puts the stop back where and when it was. The same
  // for every drag source, a stop off the rack included — `moveActivity`'s
  // fitted time above is only for a drop that names no time. The two
  // rack paths above are two dispatches, and two undos, on purpose (see
  // `unscheduleActivity`); this is a different gesture with one visible result
  // — the block moved to where its outline was — and half of it undone would
  // leave a stop at a time nobody chose, on a day nobody dropped it on.
  // `resolveDrop` has already left out whichever half changes nothing.
  const placeActivity = (outcome: PlaceOutcome) => {
    const commands = placeCommands(tripId, outcome);
    if (commands.length > 0) void dispatchBatch(commands);
  };

  // A drop on a day's "Unscheduled" chip (PR #269): the day, and no time, as ONE
  // batch for the reason `placeActivity` is — one gesture, one undo. What the
  // old "Any time" shelf's column drop did for an untimed stop, now available
  // to a timed one too: with the shelf gone, it is the one drag that takes a
  // stop's time away without taking its day (the editor's cleared Start is the
  // other way).
  const anyTimeActivity = (outcome: AnyTimeOutcome) => {
    const commands = anyTimeCommands(tripId, outcome);
    if (commands.length > 0) void dispatchBatch(commands);
  };

  // A block's bottom edge dragged (M29 part 3). Only the window: every other
  // field is omitted, which `UpdateActivity` reads as "unchanged".
  const retimeActivity = (activityId: string, timeWindow: TimeWindow) => {
    void dispatch({ type: "UpdateActivity", tripId, activityId, timeWindow });
  };

  // The mirror image of a stop put on a day from the rack, and two commands:
  // MoveActivity(toDayId: null) parks the stop, then UpdateActivity clears the
  // window — the design's "unscheduling strips the times". They are two
  // separate dispatches, so they are two separate batches in the event log and
  // therefore two separate undos (the same granularity a rack drop has). A batch would need dispatchBatch, which would make unscheduling
  // atomic in a way scheduling isn't; keeping the two symmetrical is the more
  // predictable of the two. Clearing an already-empty window is a server-side
  // no-op (harmlessly swallowed by TripProvider), so a stop that had no time
  // costs only one undo.
  const unscheduleActivity = (activityId: string) => {
    for (const move of moveCommands(activeTrip, [activityId], null)) void dispatch(move);
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
    //
    // **The batch is the head of the outcome's own history** — the apply is
    // one batch (ADR-013), and the server builds that history inside the
    // committing transaction (`executeTripCommandBatch`), so no later write
    // can be on top of it (KI-2026-09-23-f's second half, checked 2026-09-24).
    // Recorded so the card can tell whether its change is still the trip's
    // last one (M27 D17); on the queued-edits path below the board has not
    // taken this history, so the card reads "changed since" as soon as those
    // edits land, which is true.
    const batchId = result.value.history.entries[0]?.batchId ?? null;
    if (pendingRef.current) {
      patchProposal(turnId, (state) => ({
        ...state,
        status: "applied",
        batchId,
        note: `${result.value.message} It will appear on your board once your other unsaved changes have saved.`,
      }));
      return;
    }
    // Authoritative server state, taken whole, the same way an undo is.
    applyOutcome({ detail: result.value.detail, history: result.value.history });
    patchProposal(turnId, (state) => ({ ...state, status: "applied", batchId, note: result.value.message }));
  };

  // **Undo, from the card — only while the change is still the last one**
  // (M27 D17). `UndoLastChange` undoes the trip's LAST batch, whoever made it,
  // so a card whose batch is no longer the head must not send it: that would
  // take back somebody else's work under a button that says "Undo" beside
  // yours. Re-checked here against the history this render holds, not only
  // at the card, because a poll can move the head between the two.
  //
  // **Neither check is the guarantee** — both read a history up to a poll
  // interval old. The command names its batch (`undoesBatchId`) and the server
  // refuses `undo-target-changed` if anything else is on top by the time it
  // decides; the provider then refetches, and this card reads "Changed since".
  //
  // Through the provider's own `dispatch`, exactly as History's Undo is, so it
  // shares that path's refusals (view-only, unsent edits queued) and its
  // reconcile. The card reads "Put back the way it was." off the history that
  // comes back — nothing is patched here, so an undo that did not happen can
  // never be reported as one.
  const undoFor = (state: ProposalState) => proposalUndoFor(state, history);
  const undoProposal = (turnId: string) => {
    const turn = thread.find((t) => t.id === turnId);
    if (!turn || turn.role !== "assistant" || turn.proposal == null) return;
    const undoesBatchId = turn.proposal.batchId;
    if (undoesBatchId == null || undoFor(turn.proposal) !== "available") return;
    void dispatch({ type: "UndoLastChange", tripId, undoesBatchId });
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
  const isFullLens = view === "Map";

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
  const boardUsesFullWidth = view === "Plan";

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
  // page open" becomes a scope, and this screen is four of its surfaces — Plan
  // and Map, which §23 treats as one because they show the same day, and
  // Overview and Calendar, which show the whole trip (§24). The trip-wide pair
  // is keyed on `tripWideOnPhone` rather than on `view` alone: the tablet's
  // sheet reads this hint too, over the day scope it keeps.
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
  const phoneAsk = phoneAskContext(activeTrip, scopedDay, {
    tab: tripWideOnPhone ? (view === "Calendar" ? "calendar" : "overview") : view === "Map" ? "map" : "plan",
  });

  // Plan's day rail, built once and mounted in one of two places (below).
  const dayChips = (
    <DayChips
      days={chipModel(activeTrip)}
      focusedDay={focusedDay}
      // Named so the chips row knows a day was picked HERE rather
      // than handed to it — which is what lets its own scroll spy
      // be held off a pick it cannot centre. See `jumpTo`.
      onSelect={(index) => setFocusedDay(index, "chips")}
      readOnly={!canEditBoard}
      sync={chipsSync}
      // A suggested day is a stop on the phone's rail, which is how a phone
      // reaches any day it does not show. Above 768px the board draws every
      // day, ghost days included, and the rail stays the trip's own.
      suggestedDays={isPhone ? suggestions?.newDays.map((_, k) => `Day ${activeTrip.days.length + k + 1}`) : undefined}
    />
  );
  // **On a phone the day rail pins** (M39 D6, SPEC §13.4: "the day rail
  // never collapses"). It goes into the trip header's pinned box, which
  // measures it into `--sticky-stack-height`, so the day's sticky offsets and
  // the day-sync scroll margin clear it. Above 768px it stays in Plan's body,
  // for the reason given there. `useIsPhone`, not CSS: two copies would be two
  // sets of focusable chips and two owners of `chipsSync`. Its first frame
  // draws the rail one row lower, below the header rather than in it.
  const pinsDayRail = isPhone && view === "Plan";

  // The rack, in either of its places: the drawer fixed to the bottom, or on a
  // phone the row at the end of the day (M39 D6), where it covers nothing and
  // so publishes no `--rack-height`.
  const unscheduledRack = (placement: "dock" | "row") => (
    // Names a card's "Parked by" (M38), from the same cached access
    // read as the editor's provider above — no second request.
    <PeopleProvider tripId={tripId}>
      <UnscheduledRack
        placement={placement}
        items={rackItems}
        open={rack.open}
        onToggle={() => onRackEvent({ type: "toggle" })}
        onEdit={canEditBoard ? openEdit : undefined}
        // Bare, like the phone's `⋯` *Add stop*: no day is a parked stop.
        onCreate={canEditBoard ? () => openCreate() : undefined}
        reveal={rackReveal}
      />
    </PeopleProvider>
  );
  const rackIsRow = isPhone && draft === null;

  // **The phone's conflict state** (M39 D9). A jump lands on Plan, on the
  // stop's day, with its editor open for anyone who could open it from the
  // card, which is the banner's jump with the day the phone has to pick first.
  // A viewer still gets the day: finding a stop on a one-day board is reading.
  // Dismiss follows the banner's rule, and a past version on screen (history
  // preview) takes it away too, as it does the meta pill's date editor.
  const conflictsChip = (neighbour: React.RefObject<HTMLButtonElement | null>) => (
    <ConflictsChip
      conflicts={activeTrip.conflicts}
      dismissedConflictIds={activeTrip.dismissedConflictIds}
      activities={activeTrip.activities}
      onDismiss={(conflictId) => void dispatch({ type: "DismissConflict", tripId, conflictId })}
      onJump={(activityId) => {
        const day = activeTrip.days.findIndex((d) => d.activityIds.includes(activityId));
        if (day !== -1) setFocusedDay(day);
        setView("Plan");
        if (canEditBoard && preview.seq === null) openEdit(activityId);
      }}
      readOnly={!canEditBoard || boardMode === "suggest" || preview.seq !== null}
      neighbour={neighbour}
    />
  );

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
          // Not for the sheet: it takes no width from this row, so the rack
          // has none to give back (the 768–1099px band, M39 D3).
          !isDemo && assistant.open && assistantPresentation !== "sheet" && "assistant-open",
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
          // for free.
          // There WAS a second property here, `--launcher-height`, measured
          // the same way and spent by MapLens's canvas. It is gone with the
          // thing it measured: the assistant's phone entry point is now the
          // header's Ask pill (SPEC §23), and since M39 D3 at every width —
          // there is no launcher left below to measure.
          // A variable that can only ever publish `0px` is not a smaller
          // version of this one; it is a reader-facing claim that something is
          // still being measured.
          // eslint-disable-next-line no-restricted-syntax -- a measured, changing pixel height cannot be a static token
          style={{ "--rack-height": `${rackHeight}px` } as React.CSSProperties}
        >
          {/* The desktop's Ask pill lives in this header's title row (the
              phone's is the tab bar's — `usePhoneAskEntry` above), but the
              assistant's visibility belongs here — the rail is this
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
            pinned={pinsDayRail ? dayChips : undefined}
            conflicts={conflictsChip}
          >
            {/* "Beside the view tabs" (SPEC §11), so one row — and the design
                keeps it one row at every width by SCROLLING it
                (`flex-wrap: nowrap; overflow-x: auto`), not by wrapping. The
                build wrapped, so on a phone the Notebooks pill dropped onto a
                second line and pushed the day chips down; nothing here is
                worth a row of its own. */}
            {/* `max-md:hidden`: nothing in it is shown on a phone, and an
                empty row would still cost the pinned header a gap. */}
            <div className="flex flex-nowrap items-center gap-4 overflow-x-auto max-md:hidden">
              {/* `shrink-0` on the wrapper, not inside TabStrip: TabStrip is a
                  primitive with no className seam, and under `nowrap` an
                  unpinned child squeezes instead of scrolling — which is the
                  failure mode this row is being changed to avoid. */}
              {/* `hidden md:block` — SPEC §10's "two views, not four" on the
                  phone. Below 768px Overview, Plan and Map are PhoneTabBar's
                  tabs (Overview since 2026-10-01), so this strip would
                  duplicate them, plus a Calendar §10 keeps off the phone. It was also breaking this
                  row: four 26px tabs overflow a 390px screen far enough that
                  the "Notebooks" pill beside them sat 106px past the right
                  edge.

                  **Hiding this is only safe where the bar is mounted.** That
                  is `(app)/layout.tsx` for a signed-in trip and
                  `DemoTripScreen` for /demo. `(front)` has no bar of its own,
                  and before the demo mounted one, a phone visitor there had no
                  way off Overview at all. */}
              <div className="hidden shrink-0 md:block">
                <TripViewTabs />
              </div>
              {/* **The tag-focus notice used to sit here, in the toolbar, and
                  it has moved out** (SPEC §33.3, M26 link 2). Same rule as
                  Discover one surface over: a toolbar holds CONTROLS, and this
                  is a statement about the content below it — "you are looking
                  at a subset, here is how to stop". It now renders on its own
                  line above the thing it dims.

                  What went with it: the `min-w-0`/truncate squeeze it carried
                  for this row, and the explicit spacer below. The spacer
                  existed only because the line appeared and disappeared BETWEEN
                  the tabs and the pill, so `ml-auto` would have dragged the
                  pill leftwards whenever a tag came into focus. With the line
                  gone from this row, nothing moves and `ml-auto` is honest
                  again — but the spacer is kept as-is rather than swapped,
                  because the row still needs the design's 12px floor between
                  the tabs and the pill once it scrolls. */}
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
                  <NotebooksMenu tripId={tripId} myRole={myRole} />
                </div>
              )}
            </div>
            {/* §33.3: the tag-focus notice, **above the content it dims** and
                on its own line. It renders null when no tag is focused, so it
                costs nothing on a board that is not focused — which is why it
                needs no wrapper and gets none. `clearTagFilter` is unchanged;
                this link is one JSX move, exactly as §33.3 says it is. */}
            <TagFocusLine />
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
                {view === "Map" && (
                  <MapLens
                    detail={activeTrip}
                    onSelectActivity={canEditBoard ? openEdit : undefined}
                    readOnly={!canEditBoard}
                  />
                )}
              </PageContainer>
            ) : (
              <PageContainer width={boardUsesFullWidth ? "full" : "content"}>
                {/* **The day rail belongs to Plan, and scrolls with it** (SPEC
                    §35.3, M27 link 3). It used to sit in the sticky header on
                    every view but Map (and phone Overview), which made the
                    header a different height depending on the tab. Overview,
                    Calendar and Map each already show every day in their own
                    terms, so the row only does work above the columns it
                    scrolls. Rendered, not CSS-hidden, off Plan: fourteen
                    focusable chips on a view that ignores them is fourteen
                    controls for a screen reader to walk past for nothing.

                    `pt-2.5` rather than the design's 14px because the row's own
                    `pt-1` (ring clearance, see `DayChips`) makes up the rest;
                    its `pb-1` is the design's 4px below.

                    A phone pins it in the header instead (`pinsDayRail`). */}
                {view === "Plan" && !pinsDayRail && <div className="pt-2.5">{dayChips}</div>}
                {view === "Plan" && (
                  <Board
                    trip={activeTrip}
                    focusedDay={focusedDay}
                    // **One day at a time on a phone** — M26 link 13, SPEC
                    // §13.4. `useIsPhone` is the right tool here for the same
                    // reason it is on `NewTripWizard`'s sheet and the wrong one
                    // for chrome: this is a discrete layout swap CSS cannot make
                    // (a count of columns, not a width), and it starts `false`
                    // so a phone paints the desktop row for one frame before
                    // the effect corrects. That frame is a scrolling row of
                    // 268px columns rather than a wrong control, and it is the
                    // same first-frame cost `DayChips` already pays one row up.
                    oneDay={isPhone}
                    // A viewer's board, and the demo's, show the plan and offer
                    // nothing that changes it (ADR-031). `readOnly` comes from
                    // the provider's own gate — the same flag that already
                    // refuses the command — so the controls and the refusal can
                    // never disagree about who may edit. The same reasoning
                    // reached here independently from the M11 side
                    // (docs/reviews/2026-08-28-m11-pr71-review.md §5): the point
                    // is the difference between an inert board and one whose
                    // cards move and snap back.
                    //
                    // A suggester's board is live: its edits are held as a
                    // draft by that same provider (W8).
                    readOnly={!canEditBoard}
                    suggesting={boardMode === "suggest"}
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
                    // The insert half of the keep-a-day loop, which SPEC §24
                    // deleted along with `TimelineLens` — `EndOfTrip` was its
                    // only mount. Passed from here rather than imported inside
                    // `Board` because it reads `useTrip()` and `Board` is
                    // props-only; this screen is inside the provider.
                    addSavedDay={<AddSavedDayButton />}
                    // A suggester's bar stays fixed where the rack was (below).
                    endOfDay={rackIsRow ? unscheduledRack("row") : undefined}
                    suggestions={suggestions}
                    callbacks={{
                      // "columns", for the same reason the chips row names
                      // itself above: at any width where more than about two
                      // columns fit, the first and last day can never sit on
                      // this row's centre reading line, so clicking their
                      // header must not be undone by this row's own spy.
                      onSelectDay: (index: number | null) => setFocusedDay(index, "columns"),
                      onMove: moveActivity,
                      onUnschedule: unscheduleActivity,
                      onPlace: placeActivity,
                      onAnyTime: anyTimeActivity,
                      onRevealAnyTime: revealAnyTime,
                      onRetime: retimeActivity,
                      onMoveDay: moveDay,
                      onCopy: copyActivity,
                      onDragStart: () => onRackEvent({ type: "dragStart" }),
                      onDragEnd: () => onRackEvent({ type: "dragEnd" }),
                      onAddDay: () => void dispatch({ type: "AddDay", tripId, dayId: crypto.randomUUID() }),
                      onRemoveDay: (dayId) => void dispatch({ type: "RemoveDay", tripId, dayId }),
                      onRemoveActivity: (activityId) => void dispatch({ type: "RemoveActivity", tripId, activityId }),
                      onDismissConflict: (conflictId) => void dispatch({ type: "DismissConflict", tripId, conflictId }),
                    }}
                  />
                )}
                {view === "Overview" && (
                  <OverviewLens
                    // Keyed, so following a card starts from "loading" rather
                    // than showing the page it came from until the new one lands.
                    key={linkedPage ?? "overview"}
                    pageId={linkedPage}
                    detail={activeTrip}
                    tripId={tripId}
                    remoteRevision={remoteRevision}
                    confirmedSeq={confirmedSeq}
                    readOnly={readOnly}
                  />
                )}
                {view === "Calendar" && (
                  <CalendarLens detail={activeTrip} onSelectActivity={canEditBoard ? openEdit : undefined} onDrop={canEditBoard ? calendarDrop : undefined} />
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
            // **The reader's own choice from 1100px up** (SPEC §9, M26 link
            // 10a; M39 D3): this hardcoded `docked`, which is now only the
            // DEFAULT. Below 1100px it is not offered — §23 gives the phone a
            // sheet and only a sheet, and the tablet band gets the same sheet
            // so the board keeps its width — and `onShapeChange` is withheld
            // there so the rail draws no control it cannot honour.
            presentation={assistantPresentation}
            {...(assistantPresentation === "sheet" ? {} : { onShapeChange: chooseAssistantShape })}
            // **§29's "hidden, not unmounted", delivered the only way this
            // tree allows** (M26 link 10c). `/plans` is an account-scope route
            // that renders neither this screen nor the trip, so there is
            // nothing here to hide — the subtree is genuinely gone. What §29
            // is protecting is that coming back does not reset the panel, and
            // that is now true of all three things it names but one: the
            // thread already survived (`persistAs` above), the shape survives
            // (`useAssistantShape`), and the position survives through this
            // key. The open/closed state does not, deliberately —
            // `useAssistantVisibility`'s note above is the reason, and
            // `useAssistantPosition` states the trade in full.
            //
            // Per TRIP, like the thread: a panel parked clear of one trip's
            // unscheduled rack has no business deciding where another's opens.
            rememberPositionAs={`assistant:position:trip:${tripId}`}
            contextLine={isPhone ? phoneAsk.contextLine : assistantContextLine}
            scope={askScope}
            turns={thread}
            suggestions={isPhone ? phoneAsk.quickAsks : assistantSuggestions}
            // Undefined on the desktop, which leaves the rail's own trip-wide
            // sentence — §23 changes the phone and nothing above 768px.
            emptyHint={assistantPresentation === "sheet" ? phoneAsk.emptyHint : undefined}
            asksRemaining={ask.asksRemaining}
            restoreDraft={ask.restoredDraft}
            onNewConversation={ask.startNewConversation}
            onAsk={(text) => submitAssistantAsk(text)}
            onApproveProposal={(turnId) => void approveProposal(turnId)}
            onRejectProposal={rejectProposal}
            onUndoProposal={undoProposal}
            undoFor={undoFor}
            approvalBlockedReason={approvalBlockedReason}
            asking={ask.asking}
            askError={ask.askError}
            // **From the CODE, never from the prose** (M20 link 4). The refusal's
            // wording is free to change; a surface that pattern-matched on it
            // would silently fall back to a red alert the day it did.
            askUpgrade={ask.askErrorCode === AI_NOT_ENTITLED_CODE}
            simulated={ask.simulated}
            onHide={assistant.hide}
          />
        )}
      </div>
      {/* Behavior change #2 (M5 wave 2, resolves #9): the activity editor is a
          portable Sheet raised via EditorHost, mounted once here outside the
          lens switch so it's available regardless of which lens is active. */}
      {/* Names the stop editor's Who is in / Booked by (M19). The same cached
          access read TripProvider makes, so no second request. */}
      <PeopleProvider tripId={tripId}>
        <ActivityEditorSheet />
      </PeopleProvider>
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
      {/* The rack is a drop target and a set of cards that open and lift —
          all writes. Its parked ideas are still part of the plan a reader
          should see, so on a read-only board it renders inert rather than
          disappearing (UnscheduledRack reads `onEdit`'s absence). */}
      {/* **A suggester's bar is their draft, not the rack** (W69, W71;
          Mitchell's production test, 2026-10-04). The tray used to sit in the
          page flow under the header, so an edit further down the board never
          saw "N changes not sent", and a reload took the draft silently. Here
          it is pinned where the rack is, through the same wrapper, so
          `rackHeight` — and every offset that reads it — clears it too.

          On every view, not only where the rack goes: a suggester can edit
          from the Map and Calendar too (W35), and the bar is where those edits
          wait. Outside the `inert` wrapper's reach for the same reason the
          header's controls are: discarding or sending is not an edit to the
          version being previewed. */}
      {draft !== null ? (
        <div ref={rackWrapperRef}>
          <SuggestionTray draft={draft} />
        </div>
      ) : lensAcceptsDrops(view) && !rackIsRow && (
        // Unmounted on a phone, where the rack is the board's end-of-day row:
        // the ref's `null` is what puts `--rack-height` back to 0.
        <div ref={rackWrapperRef} inert={preview.seq !== null ? true : undefined}>
          {unscheduledRack("dock")}
        </div>
      )}
    </>
  );
}
