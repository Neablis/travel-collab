"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Transcript, type AssistantTurn } from "./Transcript";

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
export function AssistantRail({
  contextLine,
  turns,
  suggestions,
  onAsk,
  onNewConversation,
  asking = false,
  askError = null,
  simulated = false,
  onHide,
}: {
  contextLine: string;
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
  // Resolves false when the ask was refused before it ever reached the model
  // (unsent edits still queued, or view-only access). The rail keeps the typed
  // prompt in that case — a refusal the user has to retype is a refusal that
  // reads as the box being broken.
  onAsk: (text: string) => void | Promise<boolean | void>;
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

  const submitAsk = async () => {
    if (ask.trim() === "" || asking) return;
    const accepted = await onAsk(ask);
    if (accepted !== false) setAsk("");
  };

  return (
    <aside
      aria-label="Assistant"
      // `sticky top-14`: `top-14` is the same 56px AppHeader height
      // TripHeader's own `top-14` uses (see that file's comment) — the rail
      // sits under the app header rather than the fixed `inset-y-0` the
      // old overlay used, which rendered over the top of it. `self-start`
      // stops the flex row's default `stretch` from growing the aside to
      // match the plan column's (usually taller) content height; the height
      // below caps it at the viewport instead, so it reads as "full height
      // under the header" at every scroll position rather than growing
      // without bound. `shrink-0` holds the 356px width against the row's
      // default flex-shrink, which would otherwise squeeze it below spec on
      // a narrow viewport.
      //
      // `border-l-2 border-border-strong`, not the hairline every other
      // panel edge uses: SPEC §9 calls the docked rail's left edge "a
      // structural wall, not a card edge."
      className="sticky top-14 flex shrink-0 flex-col self-start border-l-2 border-border-strong bg-surface"
      // eslint-disable-next-line no-restricted-syntax -- 356px rail width (handoff spec) and a viewport-minus-header height have no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
      style={{ width: "356px", height: "calc(100vh - 3.5rem)" }}
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
          <Button variant="ghost" size="sm" onClick={onHide}>
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
          <Transcript turns={turns} />
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
        <div className="flex gap-1.5">
          <Input
            placeholder="Ask about this day…"
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
          <Button variant="primary" size="sm" onClick={() => void submitAsk()} disabled={asking || ask.trim() === ""}>
            {asking ? "Asking…" : "Ask"}
          </Button>
        </div>
      </div>
    </aside>
  );
}
