"use client";

import type { AssistantSuggested } from "@tc/contracts";

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
 * suggestion (ADR-067 decision 4). It reviews nothing itself: the ghosts, the
 * header's suggestions chip and *Accept all* are the review, so it says where
 * they are. A skipped snapshot is said too, in the server's own sentence.
 */
export function SuggestedNote({ suggested }: { suggested: AssistantSuggested }) {
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
      <p className="pt-0.5 text-a-note text-pretty text-brand-pressed">
        Open the suggestions in the trip header to review them, and accept or dismiss each.
      </p>
    </div>
  );
}
