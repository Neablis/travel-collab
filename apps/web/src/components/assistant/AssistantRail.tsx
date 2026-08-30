"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { MAX_ASK_MESSAGES } from "@/lib/askLimits";
import type { AskScope } from "@/lib/apiClient";
import { Transcript, type AssistantTurn } from "./Transcript";

/**
 * How close to the ceiling the warning appears, in questions still available.
 *
 * Three, so it arrives with room to finish the thought you are in the middle of
 * — a warning that fires on the last possible turn is an error message wearing a
 * warning's clothes.
 */
const ASK_WARNING_AT = 3;

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
  asksRemaining,
  restoreDraft = null,
  onAsk,
  onApproveProposal,
  onRejectProposal,
  approvalBlockedReason = null,
  onNewConversation,
  asking = false,
  askError = null,
  simulated = false,
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
  onApproveProposal: (turnId: string) => void;
  /** Discards it. Nothing is sent to the server — rejecting IS not calling it. */
  onRejectProposal: (turnId: string) => void;
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
  onHide: () => void;
}) {
  const [ask, setAsk] = useState("");

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
      className="assistant-rail flex shrink-0 flex-col self-start border-l-2 border-border-strong bg-surface"
    >
      <div className="border-b border-hairline px-4 py-3">
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
            <Button variant="ghost" size="sm" aria-label="New conversation" onClick={onNewConversation}>
              New
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={onHide}
            // Full-screen below 768px (`.assistant-rail`, globals.css) makes
            // this the ONLY way back to the plan — SPEC §13.1's 44px target
            // floor applies to it for the first time, and the added border
            // reads as an exit rather than a tertiary ghost action once
            // there is nothing else on screen to suggest one (KI-84 mobile
            // fix).
            className="max-md:h-11 max-md:min-w-11 max-md:border max-md:border-border-strong max-md:px-4"
          >
            Hide
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
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
        {turns.length === 0 ? (
          <>
            <p className="text-sm leading-relaxed text-slate">
              Ask about this trip and the conversation stays here.
            </p>
            {suggestions.length > 0 && (
              <ul aria-label="Suggested questions" className="flex flex-col items-start gap-1.5">
                {suggestions.map((question) => (
                  <li key={question}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={asking}
                      // `text-left`/`h-auto`: a derived question is a sentence,
                      // not a label, and wraps to two lines in a 356px rail.
                      className="h-auto whitespace-normal text-left"
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

      <div className="border-t border-hairline px-4 py-3">
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
            <Button variant="primary" size="sm" onClick={onNewConversation}>
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
                // Worded from the scope the question is actually asked in, the
                // same source `contextLine` is worded from — see the `scope`
                // prop. It used to say "this day" unconditionally, directly
                // under a context line reading "Looking at <trip>".
                placeholder={scope.kind === "day" ? "Ask about this day…" : "Ask about this trip…"}
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
                size="sm"
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
  );
}
