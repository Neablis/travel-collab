"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";

// M10 redesign-feedback follow-up (post-gate): the rail's header (mark,
// title, Hide) and its ask box are the SAME real conversational feature the
// board's old ComposePanel already shipped in M7 — composeAiPlan against a
// real trip — just relocated into this rail, per Mitchell's read of the
// design ("the sidebar IS the AI agent we have today, just moved").
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
// The quick-ask chip row (formerly wrapped in its own <Preview
// id="assistant-quick-asks">) is deleted along with this task, not deferred
// in place — Task 5 (M9) reintroduces suggested questions derived from real
// trip state, which is a different prop shape than a hardcoded string array,
// so there is nothing here for it to extend.
export function AssistantRail({
  contextLine,
  onAsk,
  asking = false,
  askError = null,
  simulated = false,
  onHide,
}: {
  contextLine: string;
  // Resolves false when the ask was refused before it ever reached the model
  // (today: unsent edits still queued). The rail keeps the typed prompt in
  // that case — a refusal the user has to retype is a refusal that reads as
  // the box being broken.
  onAsk: (text: string) => void | Promise<boolean | void>;
  /** True while a real composeAiPlan request from this rail is in flight. */
  asking?: boolean;
  /** Set when the last real ask failed — rendered inline, not a toast, so it
   * stays visible next to the box the user just submitted from. */
  askError?: string | null;
  /** True when the last answer was composed by the server because the ai-live
   * flag is off. The change is real; the authorship is not a model. */
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
          this rail is always docked.

          Nothing renders a conversation transcript yet (an answer becomes a
          ghost proposal on the timeline, `timeline-ghost`), so this is the
          empty hint holding the space the transcript will take. */}
      <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
        <p className="text-sm leading-relaxed text-slate">
          Ask about this trip and the conversation stays here.
        </p>
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
