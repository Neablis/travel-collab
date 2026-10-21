"use client";

import { Button } from "@/components/ui/button";

/**
 * A reviewer's Accept and Dismiss for one pending change (spec §2.4), each
 * named with the change's sentence so the several on screen stay
 * distinguishable. Props only: `SuggestionActions` runs them against the trip,
 * and the front door's assistant moment against its example on the page, which
 * is why this reads no trip of its own.
 */
export function ReviewButtons({
  description,
  accept,
  dismiss,
}: {
  description: string;
  /** Accept, or `null` where there is nothing to accept: a change that no longer applies. */
  accept: { onClick: () => void; disabled?: boolean; describedBy?: string } | null;
  dismiss: { onClick: () => void; disabled?: boolean };
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
      <Button variant="secondary" size="sm" disabled={dismiss.disabled} aria-label={`Dismiss: ${description}`} onClick={dismiss.onClick}>
        Dismiss
      </Button>
    </>
  );
}
