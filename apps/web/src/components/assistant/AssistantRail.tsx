"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";
import { Preview } from "@/components/ui/preview";

// M10 redesign-feedback follow-up (post-gate): the rail's header (mark,
// title, Hide) and its ask box are the SAME real conversational feature the
// board's old ComposePanel already shipped in M7 — composeAiPlan against a
// real trip — just relocated into this rail, per Mitchell's read of the
// design ("the sidebar IS the AI agent we have today, just moved"). Only the
// PROACTIVE half is still M9/not-built: the "What I noticed" suggestion
// cards (nothing generates real ones yet) and the quick-ask chips (nudges of
// things to ask), each wrapped in their own <Preview> below — narrower than
// the old single whole-rail wrap this replaces, so the real ask box stays
// usable while those two still read as previews.
export type Suggestion = {
  id: string;
  location: string;
  title: string;
  body: string;
  cta: string;
};

export function AssistantRail({
  contextLine,
  suggestions,
  quickAsks,
  onAsk,
  asking = false,
  askError = null,
  simulated = false,
  onKeepGhost,
  onDismiss,
  onHide,
}: {
  contextLine: string;
  suggestions: Suggestion[];
  quickAsks: string[];
  onAsk: (text: string) => void;
  /** True while a real composeAiPlan request from this rail is in flight. */
  asking?: boolean;
  /** Set when the last real ask failed — rendered inline, not a toast, so it
   * stays visible next to the box the user just submitted from. */
  askError?: string | null;
  /** True when the last answer was composed by the server because the ai-live
   * flag is off. The change is real; the authorship is not a model. */
  simulated?: boolean;
  onKeepGhost: (id: string) => void;
  onDismiss: (id: string) => void;
  onHide: () => void;
}) {
  const [ask, setAsk] = useState("");

  const submitAsk = () => {
    if (ask.trim() === "" || asking) return;
    onAsk(ask);
    setAsk("");
  };

  return (
    <>
      {/* Handoff README "Assistant rail": below 1180px the rail becomes a
          fixed overlay panel with a translucent `--color-ink` scrim behind
          it. The rail itself stays mounted at every width — this is a
          Preview shell, so it should stay inspectable at any viewport
          rather than hiding behind a toggle that Preview's pointer-events
          shield would make unreachable anyway. Only the scrim's visibility
          is a breakpoint decision, and a media query can't be expressed as
          an inline style, so it's a named class (globals.css), mirroring
          NextTripHero's `.hero-grid` precedent. */}
      {/* Handoff `current/…dc.html:546`: the scrim's job is to dismiss the rail.
          It was previously an aria-hidden div with pointer-events on and no
          handler, which made it a full-page click sink — below 1180px, where
          globals.css turns it on, every control on the trip page became inert. */}
      {/* eslint-disable-next-line no-restricted-syntax -- a full-viewport invisible
          click-catcher, not a visible control; the Button primitive's styling
          (padding, focus ring, variants) doesn't fit a layer whose only job is to
          swallow clicks outside the rail. */}
      <button
        type="button"
        aria-label="Close the assistant"
        onClick={onHide}
        className="assistant-rail-scrim fixed inset-0 z-40 cursor-default bg-ink/32"
      />
      <aside
        aria-label="Assistant"
        className="fixed inset-y-0 right-0 z-50 flex flex-col border-l border-hairline bg-surface shadow-overlay"
        // eslint-disable-next-line no-restricted-syntax -- 356px rail width (handoff spec) has no token equivalent, matching TimelineLens/MapLens/ActivityCard's computed-geometry pattern
        style={{ width: "356px" }}
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

        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto px-4 py-3.5">
          {/* Still M9: nothing generates a real suggestion yet. Narrower than
              the old whole-rail Preview wrap — the real ask box below stays
              usable regardless. */}
          <Preview id="assistant-suggestions" size="container">
            <div className="flex flex-col gap-2.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate">What I noticed</div>
              {suggestions.map((suggestion) => (
                <Card key={suggestion.id} className="flex flex-col gap-2">
                  <div className="flex items-center gap-1.5">
                    <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                    <span className="font-mono text-xs text-slate">{suggestion.location}</span>
                  </div>
                  <div className="text-sm font-semibold leading-snug text-ink">{suggestion.title}</div>
                  <p className="text-sm leading-relaxed text-slate">{suggestion.body}</p>
                  <div className="flex gap-1.5 pt-0.5">
                    <Button variant="secondary" size="sm" onClick={() => onKeepGhost(suggestion.id)}>
                      {suggestion.cta}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => onDismiss(suggestion.id)}>
                      Dismiss
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          </Preview>
        </div>

        <div className="border-t border-hairline px-4 py-3">
          {/* Still M9: these are canned nudges of what to ask, not derived
              from anything real — the real Ask box right below works today
              regardless of whether a chip was ever clicked. */}
          <Preview id="assistant-quick-asks" size="compact" className="mb-2.5 block">
            <div className="flex flex-wrap gap-1.5">
              {quickAsks.map((quickAsk) => (
                <Button
                  key={quickAsk}
                  variant="ghost"
                  size="sm"
                  className="rounded-full bg-moss text-slate hover:bg-moss"
                  onClick={() => onAsk(quickAsk)}
                >
                  {quickAsk}
                </Button>
              ))}
            </div>
          </Preview>
          {simulated && (
            <Badge variant="info" className="mb-1.5 self-start">
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
                  submitAsk();
                }
              }}
            />
            <Button variant="primary" size="sm" onClick={submitAsk} disabled={asking || ask.trim() === ""}>
              {asking ? "Asking…" : "Ask"}
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
