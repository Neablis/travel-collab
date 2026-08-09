"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Heading } from "@/components/ui/heading";
import { Input } from "@/components/ui/input";

// Task 14 (M9 Preview shell): this is the assistant rail's real prop
// contract per the M10 plan — sample data + no-op handlers today (fed by
// preview-fixtures.ts), so M9 only has to swap the data source and wire real
// handlers later, never rebuild the component shape. The caller always
// mounts this inside <Preview id="assistant-rail"> (Task 3's seam), which
// shields pointer events and stamps the "Preview · M9" chip, so none of the
// callbacks below actually fire yet.
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
  onKeepGhost,
  onDismiss,
  onHide,
}: {
  contextLine: string;
  suggestions: Suggestion[];
  quickAsks: string[];
  onAsk: (text: string) => void;
  onKeepGhost: (id: string) => void;
  onDismiss: (id: string) => void;
  onHide: () => void;
}) {
  const [ask, setAsk] = useState("");

  const submitAsk = () => {
    if (ask.trim() === "") return;
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
      <div
        aria-hidden
        className="assistant-rail-scrim fixed inset-0 z-40 bg-ink/32"
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

        <div className="border-t border-hairline px-4 py-3">
          <div className="mb-2.5 flex flex-wrap gap-1.5">
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
          <div className="flex gap-1.5">
            <Input
              placeholder="Ask about this day…"
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submitAsk();
                }
              }}
            />
            <Button variant="primary" size="sm" onClick={submitAsk}>
              Ask
            </Button>
          </div>
        </div>
      </aside>
    </>
  );
}
