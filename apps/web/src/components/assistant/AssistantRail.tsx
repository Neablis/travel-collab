"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { BrandMark } from "@/components/BrandMark";
import { Input } from "@/components/ui/input";
import { MAX_ASK_MESSAGES } from "@/lib/askLimits";
import type { AskScope } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { Transcript, type AssistantTurn } from "./Transcript";
import type { ProposalState, ProposalUndo } from "./ProposalCard";
import {
  ASSISTANT_FLOAT_SIZE,
  clampToViewport,
  floatHome,
  isMeasuredViewport,
} from "./assistantPosition";
import { useAssistantPosition } from "./useAssistantShape";
import { usePinToBottom } from "./usePinToBottom";
import { useAiEntitled } from "./useAiEntitled";

/**
 * What a gated composer says above itself, when the account has NOT yet been
 * refused anything — there is no server message for a question nobody asked.
 *
 * Deliberately not `AI_NOT_ENTITLED_REASON`, and not a copy of it. That string
 * is a refusal ("This account is on a plan that does not include it") and is
 * the right voice AFTER someone presses Ask; this is the voice before, where
 * nothing has been denied and the sentence is an offer. Two moments, two
 * sentences — sharing one would make whichever moment lost the argument read
 * slightly wrong forever.
 *
 * Names `Plus` as copy, on the same terms `modelSelection.ts` sets out at
 * length: the cheapest plan carrying `ai.ask` is a presentation fact, and
 * DERIVING it would mean reading a display order to decide what to call a
 * tier — the read `planVersions.noExtension.test.ts` exists to refuse.
 */
const UPGRADE_LEAD = "The assistant is part of Plus.";

/**
 * How close to the ceiling the warning appears, in questions still available.
 *
 * Three, so it arrives with room to finish the thought you are in the middle of
 * — a warning that fires on the last possible turn is an error message wearing a
 * warning's clothes.
 */
const ASK_WARNING_AT = 3;

/**
 * The empty state's sentence when the caller supplies none — the design file's
 * own copy (`Trip Planner Redesign.dc.html`), and a trip-wide claim.
 *
 * True of the two desktop presentations, which are only ever trip-scoped or
 * day-scoped inside one trip. Not true of §23's phone sheet, which opens on the
 * day or the page you were reading — hence `emptyHint`.
 */
const TRIP_EMPTY_HINT = "Ask about this trip and the conversation stays here.";

// M10 redesign-feedback follow-up (post-gate): the rail's header (mark,
// title, Hide) and its ask box are the SAME real conversational feature the
// board's old ComposePanel already shipped in M7 — just relocated into this
// rail, per Mitchell's read of the design ("the sidebar IS the AI agent we
// have today, just moved").
//
// M16 Wave 1 (Task 4, SPEC §9 "The assistant — one panel, three
// presentations"): this is the DOCKED presentation only — the other two
// (bubble, floating) are still M16/not-built. Docked is real layout cost, a
// flex sibling of the plan rather than `position: fixed` over it, so
// TripBoardScreen mounts this <aside> inside the same flex row as the plan
// content instead of after it. The scrim that used to sit in front of it is
// gone outright, not just hidden: it was a full-viewport `position: fixed`
// click-catcher that only existed to dismiss a rail that was itself fixed
// over the page (KI-16, KI-17) — a real flex sibling has nothing to dismiss
// past, so there is nothing left for a scrim to do.
//
// M16 Wave 2 (Task 5): the empty hint that used to hold the conversation's
// space is now an actual conversation. `turns` is the whole thread and the
// answers are the model's own prose streamed from POST /trips/:id/ask — the
// channel ADR-022 says the command endpoint structurally lacks, since that
// one can only answer with a receipt for what it already did. The chip row
// is back too, but derived (`suggestedQuestions.ts`) rather than the
// hardcoded `PREVIEW_QUICK_ASKS` array Task 4 deleted.
//
// M9 (Task 6): a turn can now carry a proposal, rendered inside the transcript
// as a ProposalCard. The rail owns none of it — it forwards two callbacks and
// one blocked-reason string, because approving reconciles authoritative server
// state onto the board and only the board can do that.
//
// Two fixes from the final branch review (2026-08-29). The composer's
// placeholder follows the SCOPE rather than saying "this day" under a context
// line that says "Looking at <trip>"; and the thread's 40-message ceiling
// (`MAX_ASK_MESSAGES`) now exists on this side of the wire, as a warning while
// it fills and an obvious exit when it is full. Before, the 41st message failed
// the turn with a server 400 nobody could act on.
//
// SPEC §23 (2026-09-05): a third presentation, `sheet` — the phone's. The
// assistant reaches a phone through an `Ask` pill in the top row, and the pill
// opens a bottom sheet over the surface it was pressed from, inheriting that
// surface's scope. This file owns the sheet; the pill and its call sites do
// not live here.
//
// It reverses the mobile half of the fix directly below this paragraph, and
// that is a decision, not an oversight — see `.assistant-sheet` (globals.css),
// which carries the reasoning where the geometry is.
//
// Mobile fix (KI-84, PR #88 preview, 2026-08-29): the 356px docked width used
// to be unconditional, so a phone-width viewport crushed the plan to a
// sliver, TripHeader's overflowing content painted over the rail, and the
// composer became genuinely unusable. Below 768px this is now a full-screen
// surface, not a squeeze of the docked one — see `.assistant-rail`
// (globals.css) for the geometry and why it lives there rather than in
// Tailwind classes on this element. The launcher pill that opens it is
// unchanged and is off-SPEC on its own terms (§13.5: "no floating action
// button") — that is a real designed-mobile-entry-point decision this fix
/**
 * Renders an assistant conversation panel in docked, floating, or modal sheet form.
 *
 * @param contextLine - Context displayed above the conversation.
 * @param scope - Scope used to tailor the composer placeholder.
 * @param turns - Conversation turns, ordered from oldest to newest.
 * @param suggestions - Questions offered when the conversation is empty.
 * @param emptyHint - Text displayed above the suggested questions.
 * @param asksRemaining - Number of questions remaining in the conversation.
 * @param restoreDraft - Question text to restore in the composer.
 * @param onAsk - Handles a submitted question. Returning `false` preserves the composer text.
 * @param onApproveProposal - Handles approval of a proposal in a turn.
 * @param onRejectProposal - Handles rejection of a proposal in a turn.
 * @param approvalBlockedReason - Explanation shown when proposal approval is unavailable.
 * @param onUndoProposal - Undoes an applied proposal while it is still the trip's last change.
 * @param undoFor - Whether an applied proposal may still be undone from its card.
 * @param asking - Whether a question is currently being processed.
 * @param askError - Error message displayed for the most recent question.
 * @param simulated - Whether the latest answer was generated in simulated mode.
 * @param presentation - Layout presentation for the panel.
 * @param onHide - Closes or hides the panel.
 */
export function AssistantRail({
  contextLine,
  scope,
  turns,
  suggestions,
  emptyHint = TRIP_EMPTY_HINT,
  asksRemaining,
  restoreDraft = null,
  onAsk,
  onApproveProposal = () => {},
  onRejectProposal = () => {},
  approvalBlockedReason = null,
  onUndoProposal,
  undoFor,
  onNewConversation,
  asking = false,
  askError = null,
  askUpgrade = false,
  aiEntitled: aiEntitledProp,
  simulated = false,
  presentation = "docked",
  onShapeChange,
  rememberPositionAs,
  onHide,
}: {
  contextLine: string;
  /**
   * What this turn is about. The composer's placeholder is worded from it, for
   * the same reason `contextLine` is: a box that says "Ask about this day…"
   * under "Looking at Rome 2027" contradicts the line directly above it (final
   * branch review, 2026-08-29, finding 3).
   */
  scope: AskScope;
  /**
   * The whole conversation, oldest first. Held by TripBoardScreen, not here:
   * the refusals below (unsent edits, view-only) have to happen BEFORE a turn
   * is appended, and the thread has to survive this rail being hidden.
   */
  turns: AssistantTurn[];
  /**
   * Derived from real trip state (`suggestedQuestions.ts`), at most four, and
   * offered only while the thread is empty — they exist to start a
   * conversation, and once one is running they would be suggesting questions
   * the user may already have had answered.
   */
  suggestions: string[];
  /**
   * The sentence shown above the suggestions while the thread is empty.
   *
   * Optional, defaulting to the design's trip-wide copy, because that sentence
   * is true of both desktop presentations and false of §23's phone sheet: a
   * sheet opened on a day or on a notebook page says the conversation is about
   * "this trip", contradicting the context line two elements above it — the
   * same defect the 2026-08-29 review's finding 3 fixed for the placeholder.
   * `phoneAskContext.emptyHint` is what the three phone call sites pass, and it
   * is derived from the surface exactly as `contextLine` is (DRIFT §2i).
   */
  emptyHint?: string;
  /**
   * How many more questions this thread has room for before the server's
   * `MAX_ASK_MESSAGES` cap refuses the turn. Counted by the board, which owns
   * the thread and builds the array that is actually posted — counting it here
   * from `turns` would be a second copy of that rule and would drift from it.
   */
  asksRemaining: number;
  /**
   * A question to put back in the composer, or `null`. Set when a turn was
   * rolled back after being accepted — the two synchronous refusals below keep
   * the typed prompt by resolving `false`, and this is the same promise kept
   * for a refusal that arrives from the server a moment later. The board
   * clears it to `null` before each ask, so the same text rolled back twice
   * still lands.
   */
  restoreDraft?: string | null;
  // Resolves false when the ask was refused before it ever reached the model
  // (unsent edits still queued, or view-only access). The rail keeps the typed
  // prompt in that case — a refusal the user has to retype is a refusal that
  // reads as the box being broken.
  onAsk: (text: string) => void | Promise<boolean | void>;
  /**
   * Commits an answer's proposal as ONE atomic batch (M9). Keyed by the turn
   * that carries it — the rail holds no proposal state of its own for the same
   * reason it holds no thread: approving reconciles authoritative server state
   * onto the board, which only the board can do.
   */
  /**
   * OPTIONAL, because not every scope can produce a proposal. A notebook page's
   * turn (M14 link 8) reaches only the page tools, which insert — there are no
   * write commands to collect, so no proposal ever arrives and a required
   * callback there would be a promise with nothing to keep. Omitted, the rail
   * renders a proposal card it can never be handed.
   */
  onApproveProposal?: (turnId: string) => void;
  /** Discards it. Nothing is sent to the server — rejecting IS not calling it. */
  onRejectProposal?: (turnId: string) => void;
  /** Why approving is unavailable right now, or `null`. */
  approvalBlockedReason?: string | null;
  /**
   * Undoes an applied card's change, and says whether it still may (M27 D17).
   * Optional for the reason `onApproveProposal` is: a scope that never holds
   * a proposal has nothing to undo, and omitting both offers no Undo at all.
   */
  onUndoProposal?: (turnId: string) => void;
  undoFor?: (state: ProposalState) => ProposalUndo | null;
  /** Clears the thread. Offered only once there is one to clear. */
  onNewConversation: () => void;
  /** True while a turn is streaming. The composer is disabled for its duration. */
  asking?: boolean;
  /** Set when the last ask failed — rendered inline, not a toast, so it
   * stays visible next to the box the user just submitted from. */
  askError?: string | null;
  /**
   * Render `askError` as an upgrade prompt rather than as a failure.
   *
   * True for exactly one refusal — the server's `ai-not-entitled`, which is a
   * 402 since M20 link 4. The board decides it from the refusal's `code`, never
   * from its prose: wording is free to change and a surface that pattern-matched
   * on it would silently fall back to a red alert the day it did.
   */
  askUpgrade?: boolean;
  /**
   * Whether this account's plan includes the assistant, or `null` while that
   * is still unknown. Omitted, the rail asks for itself (`useAiEntitled`);
   * passing it is for tests and for a caller that already knows.
   *
   * **`null` means entitled**, deliberately — see the hook for why a paywall
   * that flashes at a subscriber is the worse of the two ways to be wrong.
   *
   * This REPLACED `onOpenAccount`, which no caller ever passed: the upgrade
   * block's only real-world branch was the one rendering the sentence "Plans
   * live in your account settings", which was true of M20 and became a dead
   * end the moment §29 gave plans a route.
   */
  aiEntitled?: boolean | null;
  /** True when the last answer was composed by the server because the ai-live
   * flag is off. The answer is real; the authorship is not a model. */
  simulated?: boolean;
  /**
   * Where this panel sits. Two come from SPEC §9 (desktop), one from §23 (the
   * phone):
   *
   * - `docked` — the board's rail. Real layout cost, a flex sibling, so the
   *   plan shrinks instead of hiding. The default, so the board is unchanged.
   * - `floating` — a 364×476 card pinned to the bottom-right corner, over the
   *   page rather than beside it, which costs no layout width at all. The
   *   notebook's, on Mitchell's call: *"Assistant shouldnt be at the top, it
   *   should be on the bottom right on desktop, floating till open"*.
   * - `sheet` — §23's bottom sheet, the phone's. Rises from the bottom edge
   *   over what the reader was already looking at, with a scrim covering the
   *   phone tab bar so its scope cannot change under it (DRIFT.md 4c).
   *   Carries a scrim, which the other two deliberately do not.
   *
   * §9's remaining half — dragging the floating card by its header to park it
   * anywhere — is still not built; nothing here forecloses it. It is the part
   * of §9 that is pure interaction: where the panel opens is what Mitchell
   * reported, and where it can be MOVED to is a separate feature.
   *
   * Each selects a geometry class rather than utilities on the element, for
   * the reason `.assistant-rail`'s own comment gives at length: a utility
   * class here silently outranks this file's components layer at every width.
   *
   * **Choosing `sheet` over `docked` by viewport is the CALLER's job, and the
   * choice must not be made ACROSS the first paint.** `useIsPhone()` returns
   * `false` on the server and on the first client paint by design, so a swap
   * gated on it paints the docked rail for a frame and then replaces it. Two
   * things satisfy the rule, and only these two:
   *
   * 1. **A CSS breakpoint**, where the choice is never in JavaScript's hands
   *    at all. This is what a control that is on screen at first paint has to
   *    use — `AskPill`'s `md:hidden`, `AssistantBubble` and `PhoneTabBar` all
   *    record the same constraint and all answer it this way. For them
   *    `useIsPhone()` remains simply wrong.
   * 2. **A mount point that provably cannot exist at first paint**, where
   *    there is no frame to flash in. `TripBoardScreen` is the worked example:
   *    the rail mounts only while the assistant is open, `useAssistantVisibility`
   *    is `useState(false)` with no storage restore, no URL parameter and no
   *    server prop, and the only thing that opens it is a click — which cannot
   *    be handled before hydration, by which time `useIsPhone`'s effect has
   *    run. A breakpoint is not even available at that seam: `presentation`
   *    selects a geometry CLASS, so a media-query choice would mean mounting
   *    two rails — two composers and two transcripts in the accessibility
   *    tree. The hook also survives a resize with the panel already open,
   *    which a which-control-opened-it flag would not.
   *
   * Claiming (2) is a claim about the mount point, not about the component, so
   * the caller states which of its own state makes it true — `TripBoardScreen`
   * and `PageScreen` both do, next to the branch.
   *
   * Nothing in this component gates itself on width: whichever presentation it
   * is handed is the one it renders, at every width.
   */
  presentation?: "docked" | "floating" | "sheet";
  /**
   * **Switch shape** — SPEC §9's *"and the user picks"*, M26 link 10a.
   *
   * Absent means this caller has no other shape to offer, and the control is
   * not drawn. The phone passes nothing: §23 gives it a sheet and only a
   * sheet, and a Dock button there would offer a 356px rail on a 390px screen.
   */
  onShapeChange?: (next: "docked" | "floating") => void;
  /**
   * **Remember the dragged position under this key** — SPEC §29, M26 link 10c.
   *
   * Absent means the panel forgets where it was put the moment it unmounts,
   * which is what `/plans` used to do to it. See `useAssistantPosition` for
   * why §29's literal `visibility: hidden` is not available at this seam and
   * what is delivered instead.
   */
  rememberPositionAs?: string;
  onHide: () => void;
}) {
  const [ask, setAsk] = useState("");
  const isSheet = presentation === "sheet";
  const isFloating = presentation === "floating";

  /**
   * **Where a dragged floating panel sits** — SPEC §9, M26 link 10b.
   *
   * `null` means nobody has moved it, and the panel keeps `.assistant-float`'s
   * own `right: 16px; bottom: 16px`. That is not laziness about a default: §9
   * says *"expanding and collapsing keep the bottom-right corner planted, so
   * the panel grows out of the bubble rather than jumping across the screen"*,
   * and a CSS-pinned corner keeps that true through a resize with no JavaScript
   * running at all. A position is adopted only once a drag gives it one.
   */
  // `""` when the caller asks for no memory: the hook still runs (hooks cannot
  // be skipped), reads nothing under an empty key and writes nothing anybody
  // reads back. One code path either way, rather than a second position state.
  const [position, setPosition] = useAssistantPosition(rememberPositionAs ?? "");
  const dragFrom = useRef<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);

  /**
   * §9: *"re-clamped on resize. A narrow window no longer evicts the
   * assistant."* Only once a position exists — before that the CSS corner is
   * already doing it, and clamping a `null` would invent a position out of a
   * resize nobody asked for.
   */
  useEffect(() => {
    if (!isFloating) return;
    const reclamp = () => {
      setPosition((current) => {
        if (current === null) return null;
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        // The artboard's own guard (`dc.html:8784`): a viewport that has not
        // laid out would clamp the panel into the top-left pad and leave it
        // there, because every later re-clamp finds an already-clamped point.
        if (!isMeasuredViewport(viewport)) return current;
        return clampToViewport(current, ASSISTANT_FLOAT_SIZE, viewport);
      });
    };
    window.addEventListener("resize", reclamp);
    return () => window.removeEventListener("resize", reclamp);
    // `setPosition` is `useCallback`-stable per key, so including it would
    // re-register the listener only when the caller changes trips — harmless,
    // and no more correct than this. Named rather than silenced blindly.
  }, [isFloating, setPosition]);

  /**
   * **Dragged by its header** (§9's floating row), and by pointer events rather
   * than mouse ones so a trackpad, a pen and a touch screen all work from one
   * path.
   *
   * Listeners go on `window`, not the header: a drag that outruns the element
   * — which every fast drag does — stops receiving events the moment the
   * pointer leaves it, and the panel sticks half way. `setPointerCapture` would
   * also work and is worse here, because the capture is lost if React
   * re-renders the header for any other reason mid-drag.
   */
  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    // §9: "Docked is ... the only mode where dragging is off (cursor
    // `default`)." A sheet is pinned to an edge and has nothing to drag to.
    if (!isFloating || event.button !== 0) return;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    if (!isMeasuredViewport(viewport)) return;
    const box = panelRef.current?.getBoundingClientRect();
    const start = position ?? (box === undefined ? floatHome(viewport) : { x: box.left, y: box.top });
    dragFrom.current = { pointerX: event.clientX, pointerY: event.clientY, x: start.x, y: start.y };

    const move = (moveEvent: PointerEvent) => {
      const from = dragFrom.current;
      if (from === null) return;
      setPosition(
        clampToViewport(
          {
            x: from.x + (moveEvent.clientX - from.pointerX),
            y: from.y + (moveEvent.clientY - from.pointerY),
          },
          ASSISTANT_FLOAT_SIZE,
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const up = () => {
      dragFrom.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // Stops the drag from selecting the header's text on the way past, which
    // is what an ordinary drag over a heading does.
    event.preventDefault();
  };

  // The hook runs unconditionally — a hook cannot be skipped because a prop was
  // supplied — and the prop wins when it is given. Its read is cached and
  // deduped (ADR-046), and the rail only mounts while the assistant is OPEN,
  // so a reader who never opens it pays nothing.
  const aiEntitledFetched = useAiEntitled();
  // **`=== undefined`, not `??`.** The prop's contract is "supplied wins", and
  // `null` is a SUPPLIED value here — it means "this caller knows the answer is
  // not known yet". `??` treats it as absent and falls through to the hook, so
  // a test or caller passing `null` got whatever the fetch resolved to, which
  // for a free account is `false` — the opposite of what it asked for.
  // CodeRabbit, PR #177.
  const aiEntitled = aiEntitledProp === undefined ? aiEntitledFetched : aiEntitledProp;

  /**
   * **The composer is inert and the block above it is an offer.**
   *
   * Two ways in, and they are one state on purpose: the plan does not include
   * the assistant (`aiEntitled === false`, known before anything is typed), or
   * the server has just refused a question with 402 (`askUpgrade`). The second
   * is the first, learned the expensive way — and a reader who has hit it
   * should not then get a live-looking box inviting them to hit it again.
   *
   * `=== false`, never falsy: `null` is "not known yet" and must read as
   * entitled.
   */
  const upgradeGated = aiEntitled === false || askUpgrade;

  // **The sheet locks the DOCUMENT ELEMENT while it is open, and that is not
  // redundant with Radix's modal lock.** Mitchell, on an Android phone: *"when
  // the assistant overlay is open, you are still scrolling the background
  // rather than the assistant chat"*.
  //
  // I removed a lock from here once, on the reasoning that the wheel walk in
  // `m16-mobile-assistant.spec.ts` passed without it, so `react-remove-scroll`
  // must already be refusing wheel. CI then failed that same walk on 2bcc8a4 —
  // the plan behind the open sheet went from 42 to 442, on the first attempt
  // and again on the retry. The walk had been passing locally for a reason
  // that had nothing to do with the lock: it wheeled the page to its maximum
  // first, and this app's plan is short enough on a 412px viewport that there
  // was nowhere left to scroll (that vacuity is fixed there now).
  //
  // The gap is which element gets locked. `document.scrollingElement` is
  // `<html>` in standards mode, and `react-remove-scroll`'s scrollbar lock
  // sets `overflow: hidden` on `<body>` — which does not stop the viewport
  // scroller when that scroller is the root element. Its wheel handler is a
  // second, event-level defence that evidently holds in one Chromium and not
  // in another. Locking the root removes the class outright rather than
  // relying on either.
  //
  // Not reproducible in this container; CI reproduces it deterministically,
  // and is the proof. See KI-2026-09-06-e.
  useEffect(() => {
    if (!isSheet) return;
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous;
    };
  }, [isSheet]);

  // Where focus goes when the sheet closes. Radix's FocusScope already
  // captures this, but `DialogContentModal` overrides `onCloseAutoFocus` to
  // restore its `Dialog.Trigger` instead — and there is no Trigger here, since
  // the pill that opens the sheet lives in another component and owns the
  // `open` state itself. Its handler `preventDefault()`s FocusScope's restore
  // unconditionally and then focuses a null ref, so without this the sheet
  // closes onto nothing.
  //
  // Captured during render rather than in an effect: FocusScope's mount
  // autofocus is a CHILD effect, and child effects run before this
  // component's, so by the time an effect here could read `activeElement` the
  // opener has already lost focus.
  const openerRef = useRef<Element | null>(null);
  // **This column is the scrollport, so pinning belongs here** rather than
  // inside `Transcript`, which owns none. The component used to scroll itself
  // with `scrollIntoView`, which moves every scrollable ancestor — banned by
  // SPEC §30.6, and the reason KI-2026-09-13-a is open.
  const scrollportRef = useRef<HTMLDivElement | null>(null);
  // `[turns]` and not `[turns.length]`: a streaming answer mutates the LAST
  // turn without adding one, and following the tokens as they arrive is the
  // whole reason a transcript scrolls at all.
  usePinToBottom(scrollportRef, [turns]);
  if (isSheet && openerRef.current === null) openerRef.current = document.activeElement;

  useEffect(() => {
    if (restoreDraft !== null) setAsk(restoreDraft);
  }, [restoreDraft]);

  const threadFull = asksRemaining <= 0;

  const submitAsk = async () => {
    // `upgradeGated` here as well as on the two controls: the suggestion chips
    // and the Enter key both reach `onAsk` without passing the Ask button, so
    // a gate spelled only on the button is a gate with two ways around it.
    if (ask.trim() === "" || asking || threadFull || upgradeGated) return;
    const accepted = await onAsk(ask);
    if (accepted !== false) setAsk("");
  };

  const panel = (
    <>
      {/* §23's scrim, and the reason it exists is not decoration: DRIFT.md
          build-check 4c requires the phone tab bar to be unreachable behind an
          open sheet, because switching tabs under one would change the
          conversation's scope halfway through it — the exact failure §23's
          "the pill inherits the surface's scope" is built to avoid. Covering
          the bar is therefore the scrim's JOB, and `.assistant-sheet-scrim`
          (globals.css) carries the z-index that does it.

          Click-to-dismiss, per the design, but `aria-hidden` and unfocusable:
          it is a second route to the ✕ below rather than a second control, so
          announcing it would be announcing the same action twice. A plain
          <div> for the same reason — a real <button> here would sit in the tab
          order in front of everything in the sheet.

          It sits INSIDE the `Dialog.Content` below rather than beside it, and
          that placement is doing two jobs. Radix's modal layer sets
          `pointer-events: none` on <body> and re-enables it only on the
          content, so a scrim outside would be a dismissal surface that no
          longer takes clicks; and a pointerdown on it would count as an
          interaction OUTSIDE the dialog, so Radix would dismiss and then this
          `onClick` would call `onHide` a second time. */}
      {isSheet && (
        <div aria-hidden data-testid="assistant-scrim" className="assistant-sheet-scrim" onClick={onHide} />
      )}
      <aside
        ref={panelRef}
        aria-label="Assistant"
        // **The dragged position, and only once there is one.** Until a drag
        // gives the panel a point it keeps `.assistant-float`'s own
        // `right`/`bottom`, which is what holds §9's planted bottom-right
        // corner through a resize with no JavaScript running.
        //
        // `right: auto` is not optional: the CSS pins the RIGHT edge, so
        // setting `left` alone would stretch the card between the two rather
        // than move it. Same for `bottom`.
        //
        // Written as a literal `style` attribute so the lint wall SEES it and
        // this exception is a reviewed one. The first version spread a
        // conditional object — `{...(cond ? { style } : {})}` — which slipped
        // past the rule entirely and reported the disable below as unused.
        // That is the wall working, and smuggling an inline style past it
        // because the check is syntactic would be the wrong lesson.
        //
        // eslint-disable-next-line no-restricted-syntax -- a dragged position is a pixel pair computed at runtime from a pointer; no token, scale step or class can express it, and `.assistant-float` owns every part of this element's geometry that IS expressible.
        style={
          isFloating && position !== null
            ? { left: position.x, top: position.y, right: "auto", bottom: "auto" }
            : undefined
        }
        // `.assistant-rail` (globals.css) carries ALL of this element's
        // position/width/height, docked and full-screen alike — see that
        // class's own comment (KI-84 mobile fix) for why `top-14`/`sticky`
        // moved out of Tailwind utilities and the 356px/100vh geometry out of
        // an inline style: a utility class here would silently outrank a
        // media-query override in that file regardless of which query
        // matched, and an inline style outranks it even harder. `self-start`
        // stops the flex row's default `stretch` from growing the aside to
        // match the plan column's (usually taller) content height while
        // docked; irrelevant once the mobile rule takes the element out of
        // flow with `position: fixed`, and harmless there. `shrink-0` holds
        // the 356px width against the row's default flex-shrink while docked.
        //
        // `border-l-2 border-border-strong`, not the hairline every other
        // panel edge uses: SPEC §9 calls the docked rail's left edge "a
        // structural wall, not a card edge." Left as-is full-screen — a 2px
        // border at the viewport's own left edge costs nothing.
        //
        // `floating` swaps the geometry AND the edge: §9's "structural wall, not
        // a card edge" is a statement about the DOCKED rail, which abuts the plan
        // it shrank. A floating card abuts nothing — it is a card over a page, so
        // it takes a card's hairline border, radius and overlay shadow.
        //
        // `sheet` takes only the TOP edge's hairline — it abuts the bottom of
        // the screen on the other three, and the design draws its 18px top
        // radius there for the same reason. That radius stays in
        // `.assistant-sheet` rather than becoming a `rounded-*` utility here:
        // 18px is off the radius scale, so there is nothing to name it with.
        // `overflow-hidden` is what makes the header's own border stop at the
        // rounded corner instead of squaring it off.
        className={cn(
          "flex flex-col bg-surface",
          presentation === "floating"
            ? "assistant-float overflow-hidden rounded-lg border border-hairline shadow-overlay"
            : isSheet
              ? "assistant-sheet overflow-hidden border-t border-hairline"
              : "assistant-rail shrink-0 self-start border-l-2 border-border-strong",
        )}
      >
        {/* `shrink-0` here and on the composer below, `min-h-0` on the
            conversation between them: the sheet is the first presentation
            with a MAX height rather than a fixed one, so without these the
            flex column shares the shortfall out across all three boxes and
            the header and composer get squeezed instead of the transcript
            scrolling. Harmless in the other two, which never run short. */}
        <div
          className={cn(
            "shrink-0 border-b border-hairline px-4 py-3",
            // §9: "Docked is ... the only mode where dragging is off (cursor
            // `default`)." The cursor IS the affordance — it is the only thing
            // that says this row can be grabbed before somebody tries.
            isFloating && "cursor-grab select-none",
          )}
          {...(isFloating ? { onPointerDown: startDrag } : {})}
          data-testid="assistant-header"
        >
          <div className="flex items-center gap-2">
            <BrandMark size={24} />
            {/* The same heading in all three presentations; in the sheet it
                is additionally the dialog's accessible name, so the modal
                announces itself with the words already on screen rather than
                a second label invented for screen readers. */}
            {isSheet ? (
              <RadixDialog.Title asChild>
                <Heading level={4} className="font-semibold">
                  Assistant
                </Heading>
              </RadixDialog.Title>
            ) : (
              <Heading level={4} className="font-semibold">
                Assistant
              </Heading>
            )}
            <div className="flex-1" />
            {/* **Dock / Float** — SPEC §9's *"and the user picks"*, the four
                words this build was missing (M26 link 10a). The artboard draws
                one button whose title flips (`dc.html:4018`/`:10062`), so this
                is one control, not two, and its accessible NAME flips with it
                — a button called "Dock" that undocks is worse than no button.

                Not rendered in the sheet, and not rendered when the caller
                offers no handler: §23 gives the phone a sheet and only a
                sheet, and a Dock button there would offer a 356px rail on a
                390px screen.

                **`onPointerDown` stops here.** The whole header is the drag
                handle in floating mode, so without this a press on this button
                starts a drag and the click that follows lands on a panel that
                has already moved under the pointer. */}
            {!isSheet && onShapeChange !== undefined && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={isFloating ? "Dock to the side" : "Float it free"}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => onShapeChange(isFloating ? "docked" : "floating")}
              >
                {isFloating ? "Dock" : "Float"}
              </Button>
            )}
            {turns.length > 0 && (
              <Button
                variant="ghost"
                size={isSheet ? "touch" : "sm"}
                aria-label="New conversation"
                onClick={onNewConversation}
              >
                New
              </Button>
            )}
            {/* ONE dismissal control, whichever presentation this is. The
                design draws an ✕ at the sheet's top-right where docked and
                floating write "Hide" (`…dc.html:895`), so the glyph changes
                and the control does not — a sheet carrying both an ✕ and a
                Hide would be the same act twice in a 390px row (RULES.md rule
                4), and the scrim behind it is already a second ROUTE to it.
                The accessible name stays "Hide" across all three: it is one
                control, and renaming it per presentation would only mean
                every caller and spec that reaches for it has to know which
                geometry it is in.

                `size="touch"` is SPEC §13.1's 44px floor, and it is the
                design's exact 44×44 here — `min-w-11` wins over `px-3.5` for
                a single glyph, so the box is square without a second rule
                saying so. */}
            <Button
              variant="ghost"
              size={isSheet ? "touch" : "sm"}
              aria-label="Hide"
              onClick={onHide}
              // Full-screen below 768px (`.assistant-rail`, globals.css) makes
              // this the ONLY way back to the plan — SPEC §13.1's 44px target
              // floor applies to it for the first time, and the added border
              // reads as an exit rather than a tertiary ghost action once
              // there is nothing else on screen to suggest one (KI-84 mobile
              // fix). Not applied to the sheet: `size="touch"` already carries
              // the floor there, and the sheet is never the only thing on
              // screen — the plan is visible behind it, which is the whole
              // difference between §23's sheet and KI-84's takeover.
              className={cn(!isSheet && "max-md:h-11 max-md:min-w-11 max-md:border max-md:border-border-strong max-md:px-4")}
            >
              {isSheet ? "✕" : "Hide"}
            </Button>
          </div>
          <div className="mt-2 rounded-sm bg-paper px-2.5 py-1.5 text-xs text-slate">{contextLine}</div>
        </div>

        {/* The design's assistant panel is header -> context -> conversation
            -> ask box. There is no "What I noticed" block: Mitchell, preview
            feedback on PR #55 — "What i noticed was removed, its not the chat
            box area for talking with bot". The 2026-08-24 handoff's own panel
            markup agrees; the shelf was ours, not the design's. Docked mode
            drops the "drag the header to park it anywhere" copy the other two
            presentations use — dragging is off while docked (SPEC §9), and
            this rail is always docked. */}
        {/* `overscroll-contain`: a fling that reaches the end of the transcript
            must not chain out into whatever scrolls behind it. This is the part
            of the 2026-09-06 scroll-through report that stands on its own — it
            is correct for any scrollable panel inside an overlay regardless of
            what the modal lock does, and it is the mechanism most likely to
            produce that symptom under touch. It is NOT verified against the
            report: see the note by `isSheet` and KI-2026-09-06-e. */}
        <div
          ref={scrollportRef}
          className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto overscroll-contain px-4 py-3.5"
        >
          {turns.length === 0 ? (
            <>
              <p className="text-sm leading-relaxed text-slate">{emptyHint}</p>
              {suggestions.length > 0 && (
                <ul aria-label="Suggested questions" className="flex flex-col items-start gap-1.5">
                  {suggestions.map((question) => (
                    <li key={question}>
                      <Button
                        variant="secondary"
                        size={isSheet ? "touch" : "sm"}
                        // A suggested question is an ask with the typing done
                        // for you, so it is gated exactly as the composer is —
                        // leaving these live would make the disabled box below
                        // decorative.
                        disabled={asking || upgradeGated}
                        // `text-left`/`h-auto`: a derived question is a sentence,
                        // not a label, and wraps to two lines in a 356px rail.
                        // `h-auto` is dropped in the sheet: `touch` sets a
                        // MIN height rather than a fixed one, so a wrapped
                        // two-line question already grows the chip — and
                        // `h-auto` would undo the 44px floor it is there to
                        // keep (SPEC §13.1).
                        className={cn("whitespace-normal text-left", !isSheet && "h-auto")}
                        onClick={() => void onAsk(question)}
                      >
                        {question}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <Transcript
              turns={turns}
              onApproveProposal={onApproveProposal}
              onRejectProposal={onRejectProposal}
              approvalBlockedReason={approvalBlockedReason}
              touch={isSheet}
              {...(onUndoProposal === undefined ? {} : { onUndoProposal })}
              {...(undoFor === undefined ? {} : { undoFor })}
            />
          )}
        </div>

        <div className="shrink-0 border-t border-hairline px-4 py-3">
          {simulated && (
            <Badge variant="info" className="mb-1.5 self-start" role="status">
              Simulated
            </Badge>
          )}
          {/* **An upgrade path, not a permission error** (M20 link 4's gate
              box). The server answers 402 Payment Required rather than 403
              here, and the two differ by exactly this: a 403 says the account
              did something it may not, and a 402 says the account does not
              have a thing it could have. Rendering both as a red alert throws
              that distinction away at the one surface where it is worth
              anything — so the gate is `role="status"` and the transport
              failure below it is `role="alert"`.

              **It no longer waits for a refusal.** `upgradeGated` is true from
              the moment the plan is known not to include the assistant, which
              is what lets the composer below be inert rather than live-looking.
              Reported on the preview, 2026-09-15: *"the assistant should still
              be openable but the input should be disabled, and the text
              container above should be a CTA To upgrade"*.

              **Still no price — but now a way out.** The line this replaces
              ended *"Plans live in your account settings"*, which was the
              honest answer in M20, when there was no chooser and no checkout
              to send anyone to. §29 gives plans a route, and puts the price
              only on it, so this names the destination rather than a number. */}
          {upgradeGated ? (
            <div role="status" className="mb-1.5 flex flex-col items-start gap-1.5">
              {/* The server's own words when THIS refusal is the entitlement
                  one, ours otherwise — see `UPGRADE_LEAD` for why these are
                  two sentences rather than one shared string.

                  `askUpgrade &&`, not a bare `askError ??`: a transport
                  failure from before the plan finished loading (the model
                  unavailable, a dropped connection) leaves `askError` set with
                  `askUpgrade` false, and reading it here would print "The
                  model is unavailable right now" above a See plans button —
                  a network blip dressed as a paywall. */}
              <p className="text-xs text-ink">
                {askUpgrade && askError !== null ? askError : UPGRADE_LEAD}
              </p>
              <p className="text-xs text-slate">
                Planning a trip is always free — days, activities, costs and your notebook are all
                included.
              </p>
              {/* `buttonVariants` on a `Link`: this navigates out of the trip,
                  the repo's pattern for which is an anchor, not a Button with
                  an onClick (PlanSection:218). */}
              <Link
                href="/plans"
                className={buttonVariants({ variant: "primary", size: isSheet ? "touch" : "sm" })}
                data-testid="assistant-upgrade-cta"
              >
                See plans
              </Link>
            </div>
          ) : askError !== null ? (
            <p role="alert" className="mb-1.5 text-xs text-danger">
              {askError}
            </p>
          ) : null}
          {threadFull ? (
            // The composer is REPLACED, not disabled beside a warning: at this
            // point there is exactly one thing to do, and the only previous signal
            // was a server 400 that rolled the question back into a box which
            // still looked ready to take it. Nothing is trimmed — the thread the
            // user can see is the thread that exists, and starting a new one is
            // their call to make, not something done under them.
            <div role="status" className="flex flex-col items-start gap-1.5">
              <p className="text-xs text-slate">
                This conversation has reached its limit of {MAX_ASK_MESSAGES} messages. Start a new one to keep asking —
                this one stays on screen until you do.
              </p>
              <Button variant="primary" size={isSheet ? "touch" : "sm"} onClick={onNewConversation}>
                Start a new conversation
              </Button>
            </div>
          ) : (
            <>
              {asksRemaining <= ASK_WARNING_AT && (
                <p role="status" className="mb-1.5 text-xs text-slate">
                  {asksRemaining === 1
                    ? "Room for 1 more question in this conversation."
                    : `Room for ${asksRemaining} more questions in this conversation.`}
                </p>
              )}
              <div className="flex gap-1.5">
                <Input
                  // Worded FROM the scope, for the same reason `contextLine` is:
                  // a box that says "Ask about this day…" under "Looking at Rome
                  // 2027" contradicts the line directly above it. A page's box
                  // says "add to", not "ask about" — its tools insert, and the
                  // one thing a reader must not have to discover by trying is
                  // that an answer here lands in the document.
                  placeholder={
                    scope.kind === "day"
                      ? "Ask about this day…"
                      : scope.kind === "page"
                        ? "Ask AI to add to this page…"
                        : "Ask about this trip…"
                  }
                  // `h-11` in the sheet, overriding the primitive's `h-9`:
                  // SPEC §13.1's floor is every control, and the box the
                  // whole sheet exists to reach is the last one that should
                  // be under it. Not the `touch` size the Buttons take —
                  // `Input` has no size variant, and inventing one for a
                  // single call site would be a design-system change made
                  // sideways.
                  className={cn(isSheet && "h-11")}
                  value={ask}
                  onChange={(e) => setAsk(e.target.value)}
                  // **The one case where this input IS disabled**, and it does
                  // not contradict KI-2026-09-07-c below. That entry is about
                  // disabling a FOCUSED box mid-turn and losing the keystrokes
                  // in it; this is a box nobody can usefully type into at all,
                  // disabled from first paint rather than under a cursor, and
                  // there is no follow-up to drop because no question can be
                  // sent from here until the plan changes.
                  disabled={upgradeGated}
                  // NOT `disabled={asking}` (KI-2026-09-07-c). Disabling a
                  // focused input blurs it, in every real browser jsdom does
                  // not reproduce, and re-enabling it afterwards does not
                  // restore focus — so a follow-up typed mid-turn went to
                  // `<body>` and was silently dropped, `Enter` included.
                  // `submitAsk` already refuses to send while `asking` is
                  // true (and the `Button` below stays disabled), so nothing
                  // downstream needs the input itself gated: leaving it
                  // editable keeps focus and keeps the keystrokes. Note it
                  // does NOT auto-send them — `submitAsk` still returns early
                  // while `asking`, so an Enter pressed mid-turn is a no-op
                  // and the text simply waits in the composer for the user to
                  // send it. Keeping what was typed is the fix; auto-sending a
                  // follow-up the user has not re-confirmed would be a
                  // behaviour change this entry did not ask for.
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitAsk();
                    }
                  }}
                />
                <Button
                  variant="primary"
                  // **`md`, not `sm`, so this button is exactly as tall as the
                  // box beside it.** `Input` is `h-9`; `sm` is `h-7`, which
                  // left a 2px gap above and below the button on every desktop
                  // composer. Reported on the preview, 2026-09-15: *"This ask
                  // button in the AI agent should be same height as the text
                  // input"*. In the sheet the pair is `h-11` and `min-h-11`,
                  // which already matched — `touch` stays.
                  size={isSheet ? "touch" : "md"}
                  onClick={() => void submitAsk()}
                  disabled={asking || ask.trim() === "" || upgradeGated}
                  // `aria-label`, only while idle (KI-2026-09-05-ac): this
                  // button's visible "Ask" is the same accessible name §23's
                  // header pill carries, and on the phone sheet both are
                  // reachable at once. WCAG 2.5.3 only requires the accessible
                  // name to CONTAIN the visible label, not equal it, so
                  // lengthening this one — the pill's own comment is explicit
                  // that ITS name has to stay the bare visible word — clears
                  // the collision without touching either visible label.
                  // Omitted while `asking`: the visible text is "Asking…" at
                  // that point, and a stale static label would no longer
                  // contain it, which is the same 2.5.3 rule the other way.
                  aria-label={asking ? undefined : "Ask the assistant"}
                >
                  {asking ? "Asking…" : "Ask"}
                </Button>
              </div>
            </>
          )}
        </div>
      </aside>
    </>
  );

  if (!isSheet) return panel;

  // §23's sheet is a MODAL and the other two presentations are not, so only
  // this one is wrapped. The scrim already covers the phone tab bar for a
  // finger (DRIFT.md build-check 4c), but a scrim stops pointers and nothing
  // else: before this, focus stayed on the pill behind the sheet, Tab reached
  // the tab bar underneath it, and Escape did nothing — so a keyboard or
  // screen-reader user could still switch tabs mid-conversation and change the
  // scope out from under it, which is the single failure 4c exists to prevent
  // (Copilot, PR #148).
  //
  // Radix rather than the platform, and that is a measured choice, not a
  // preference: jsdom 29.1.1 ships neither `HTMLDialogElement.showModal` nor
  // `HTMLElement.inert` (probed 2026-09-05), so a `<dialog showModal>` would
  // be a modal claim no unit test in this repo could hold. Radix's FocusScope
  // and DismissableLayer are plain JS and are exercised by the tests beside
  // this file. It is the same primitive `ui/sheet.tsx` uses, which is why
  // there is no second trap here to keep in step with that one.
  //
  // `Dialog.Content` wraps the <aside> instead of BEING it (`asChild`), which
  // would have been the tidier tree. It cannot be: `Content` renders
  // `role="dialog"`, and this element is addressed as
  // `getByRole("complementary", { name: "Assistant" })` by five e2e specs and
  // four screen suites, and as `[aria-label="Assistant"]` by the z-order and
  // hit-test probes in `m16-mobile-assistant.spec.ts`. It also has to keep
  // carrying `.assistant-sheet` itself, because that is the element those
  // probes measure the 80dvh/bottom-anchored geometry on. `contents` gives the
  // dialog no box of its own, so the sheet's geometry and the row it is
  // mounted in are both untouched.
  //
  // `aria-modal` is set here rather than inherited: Radix relies on
  // `hideOthers` (a real `aria-hidden` on everything outside this subtree) and
  // does not set the attribute, but the two say the same thing to different
  // assistive tech and the sheet should be legible to both.
  return (
    <RadixDialog.Root
      open
      onOpenChange={(next) => {
        if (!next) onHide();
      }}
    >
      <RadixDialog.Content
        aria-modal
        // Radix warns when a `Content` has no `Description`; this sheet has no
        // one sentence that describes it — the context line names the scope
        // and the transcript is the content. Opting out explicitly is Radix's
        // own documented way of saying so.
        aria-describedby={undefined}
        className="contents"
        onCloseAutoFocus={() => {
          const opener = openerRef.current;
          // `isConnected`: the surface that owned the pill can unmount with
          // the sheet (a route change), and focusing a detached node silently
          // sends focus to <body> instead of leaving it where it was.
          if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
        }}
      >
        {panel}
      </RadixDialog.Content>
    </RadixDialog.Root>
  );
}
