"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { MAX_ASK_MESSAGES } from "@/lib/askLimits";
import type { AskScope } from "@/lib/apiClient";
import { cn } from "@/lib/cn";
import { Transcript, type AssistantTurn } from "./Transcript";

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
// does not make; see KI-84.
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
  onNewConversation,
  asking = false,
  askError = null,
  simulated = false,
  presentation = "docked",
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
  /** Clears the thread. Offered only once there is one to clear. */
  onNewConversation: () => void;
  /** True while a turn is streaming. The composer is disabled for its duration. */
  asking?: boolean;
  /** Set when the last ask failed — rendered inline, not a toast, so it
   * stays visible next to the box the user just submitted from. */
  askError?: string | null;
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
  onHide: () => void;
}) {
  const [ask, setAsk] = useState("");
  const isSheet = presentation === "sheet";

  useEffect(() => {
    if (restoreDraft !== null) setAsk(restoreDraft);
  }, [restoreDraft]);

  const threadFull = asksRemaining <= 0;

  const submitAsk = async () => {
    if (ask.trim() === "" || asking || threadFull) return;
    const accepted = await onAsk(ask);
    if (accepted !== false) setAsk("");
  };

  return (
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
          order in front of everything in the sheet. */}
      {isSheet && (
        <div aria-hidden data-testid="assistant-scrim" className="assistant-sheet-scrim" onClick={onHide} />
      )}
      <aside
        aria-label="Assistant"
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
        <div className="shrink-0 border-b border-hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="grid shrink-0 place-items-center rounded-md bg-brand text-surface"
              // eslint-disable-next-line no-restricted-syntax -- 22px mark circle has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
              style={{ height: "22px", width: "22px", fontSize: "11px" }}
            >
              ◎
            </span>
            <Heading level={4} className="font-semibold">
              Assistant
            </Heading>
            <div className="flex-1" />
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
        <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
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
                        disabled={asking}
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
            />
          )}
        </div>

        <div className="shrink-0 border-t border-hairline px-4 py-3">
          {simulated && (
            <Badge variant="info" className="mb-1.5 self-start" role="status">
              Simulated
            </Badge>
          )}
          {askError !== null && (
            <p role="alert" className="mb-1.5 text-xs text-danger">
              {askError}
            </p>
          )}
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
                  disabled={asking}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void submitAsk();
                    }
                  }}
                />
                <Button
                  variant="primary"
                  size={isSheet ? "touch" : "sm"}
                  onClick={() => void submitAsk()}
                  disabled={asking || ask.trim() === ""}
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
}
