"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import type { Ghost } from "@/lib/suggestionOverlay";

/**
 * What a ghost's popover holds: each change's sentence over its actions.
 * Props only and apart from the popover, so the front door's assistant moment
 * (M51) can draw it standing open, with its example's actions in place of the
 * trip's.
 */
export function SuggestionReviewList({ ghosts, actions }: { ghosts: readonly Ghost[]; actions: (ghost: Ghost) => ReactNode }) {
  return (
    <ul aria-label="Suggested changes" className="m-0 flex list-none flex-col gap-3 p-0">
      {ghosts.map((ghost) => (
        <li key={ghost.changeId} className="flex flex-col gap-1.5">
          <Text as="span" className="text-sm text-ink">
            {ghost.description}
          </Text>
          {actions(ghost)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Accept, Dismiss and Withdraw for one pending change (spec §2.4, §2.7), each
 * named with the change's sentence so the several on screen stay
 * distinguishable. Props only: `SuggestionActions` runs them against the trip,
 * and the front door's assistant moment against its example on the page, which
 * is why this reads no trip of its own.
 */
export function ReviewButtons({
  description,
  accept,
  dismiss,
  withdraw = null,
}: {
  description: string;
  /** Accept, or `null` where there is nothing to accept: a change that no longer applies, or a reader who is not a reviewer. */
  accept: { onClick: () => void; disabled?: boolean; describedBy?: string } | null;
  /** Dismiss, or `null` for a reader who is not a reviewer. */
  dismiss: { onClick: () => void; disabled?: boolean } | null;
  /** Withdraw, the author's: `null` for anyone else. */
  withdraw?: { onClick: () => void; disabled?: boolean } | null;
}) {
  return (
    <>
      {accept !== null && (
        <Button
          variant="primary"
          size="sm"
          disabled={accept.disabled}
          aria-describedby={accept.describedBy}
          aria-label={`Accept: ${description}`}
          onClick={accept.onClick}
        >
          Accept
        </Button>
      )}
      {dismiss !== null && (
        <Button variant="secondary" size="sm" disabled={dismiss.disabled} aria-label={`Dismiss: ${description}`} onClick={dismiss.onClick}>
          Dismiss
        </Button>
      )}
      {withdraw !== null && (
        <Button variant="secondary" size="sm" disabled={withdraw.disabled} aria-label={`Withdraw: ${description}`} onClick={withdraw.onClick}>
          Withdraw
        </Button>
      )}
    </>
  );
}
