"use client";

import { useState } from "react";
import type { AssistantSuggested } from "@tc/contracts";
import { useAcceptAll } from "@/components/trip/context/useAcceptAll";
import { Button } from "@/components/ui/button";

/**
 * What the chat says for a turn whose changes went on the board (ADR-067),
 * in one sentence: "I put 3 suggestions on the board and saved a snapshot
 * “Before: add a day in Kyoto”." The live region reads the same words.
 */
export function suggestedWords({ changeCount, snapshotName }: AssistantSuggested): string {
  const what = changeCount === 1 ? "1 suggestion" : `${changeCount} suggestions`;
  return snapshotName === null
    ? `I put ${what} on the board.`
    : `I put ${what} on the board and saved a snapshot “${snapshotName}”.`;
}

/**
 * The note in place of a proposal card when a turn's changes were stored as a
 * suggestion (ADR-067 decision 4). It says where they are, and offers the one
 * decision that needs no list: *Accept all* (Mitchell's preview comment,
 * 2026-10-10), the chip's own button through `useAcceptAll`, so it takes every
 * pending change that still applies as one History entry. Picking some, or
 * dismissing any, stays in the header's suggestions chip. A skipped snapshot
 * is said too, in the server's own sentence.
 */
export function SuggestedNote({ suggested }: { suggested: AssistantSuggested }) {
  const accept = useAcceptAll();
  const [accepted, setAccepted] = useState(false);
  const offer = accept !== null && !accepted && (accept.acceptable.length > 0 || accept.accepting);
  return (
    <div role="group" aria-label="Suggestions on the board" className="rounded-a-card border border-brand bg-brand-tint p-3">
      <p className="text-a-chat font-semibold text-pretty text-brand-pressed">{suggestedWords(suggested)}</p>
      {/* What the resolver could not match, as the card says it. */}
      {suggested.skipped.length > 0 && (
        <p className="pt-0.5 text-a-note text-pretty text-brand-pressed">{suggested.skipped.join(" · ")}</p>
      )}
      {suggested.snapshotSkipped !== undefined && (
        <p className="pt-0.5 text-a-note text-pretty text-slate">No snapshot this time: {suggested.snapshotSkipped}</p>
      )}
      {accepted ? (
        <p role="status" className="pt-0.5 text-a-note text-pretty text-brand-pressed">
          Accepted as one change. Undo takes it all back.
        </p>
      ) : (
        <p className="pt-0.5 text-a-note text-pretty text-brand-pressed">
          {offer
            ? "Accept them all here, or open the suggestions in the trip header to pick some or dismiss them."
            : "Open the suggestions in the trip header to review them, and accept or dismiss each."}
        </p>
      )}
      {offer && (
        <Button
          variant="primary"
          size="sm"
          className="mt-2"
          disabled={accept.accepting}
          onClick={() => void accept.acceptAll().then((ok) => ok && setAccepted(true))}
        >
          {accept.accepting ? "Accepting…" : "Accept all"}
        </Button>
      )}
      {accept?.refusal != null && (
        <p role="alert" className="pt-1 text-a-note text-pretty text-danger-ink">
          {accept.refusal}
        </p>
      )}
    </div>
  );
}
