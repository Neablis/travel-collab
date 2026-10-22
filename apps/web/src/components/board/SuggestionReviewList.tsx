"use client";

import type { ReactNode } from "react";
import { Text } from "@/components/ui/text";
import type { Ghost } from "@/lib/suggestionOverlay";

/**
 * What a ghost's popover holds: each change's sentence over its actions.
 * Props only and apart from the popover, so the front door's assistant moment
 * (M51) can draw it standing open, with a picture of the actions in place of
 * the trip's.
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
