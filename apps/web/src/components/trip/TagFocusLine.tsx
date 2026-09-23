"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TAG_CHIP_CLASS, TAG_LABEL } from "@/lib/activityTags";
import { cn } from "@/lib/cn";
import { useFocus } from "./context/FocusProvider";

/**
 * SPEC §11: *"When focus is active, a line beside the view tabs names the tag
 * and offers Clear."*
 *
 * **It sat beside `TripViewTabs` until M26 link 2; it is above the lens content
 * now** (SPEC §33.3). The old reasoning was that focus is cross-lens state — it
 * survives every tab in that strip — so a line that moved or vanished per lens
 * would read as belonging to whichever lens was showing. That still holds, and
 * this placement keeps it: the line is above the CONTENT, outside every lens,
 * and it is rendered once by `TripBoardScreen` rather than per lens.
 *
 * What changed is the other half. §33.3 applies Discover's rule one surface
 * over — a toolbar holds controls, and this is not one. It is a statement about
 * the list below it ("you are looking at a subset, here is how to stop"), so it
 * belongs above the thing it describes rather than in the row of things that
 * change it.
 *
 * It renders nothing at all when no tag is focused. That is the whole
 * difference between this and the header filter row it replaced (KI-47): the
 * filter row was permanent chrome asking a question nobody had asked yet, and
 * this is a receipt for a question you just asked by clicking a chip. There is
 * deliberately no "Show everything" control and no tag picker here — the only
 * way IN is a stop's own chip, which is what makes focus feel like a property
 * of the plan rather than of the toolbar.
 */
export function TagFocusLine() {
  const { focusedTag, clearFocusedTag } = useFocus();
  if (focusedTag === null) return null;

  return (
    // `flex-wrap` rather than the `min-w-0`/truncate squeeze this carried in
    // the toolbar: on its own line there is room, so a long tag name wraps
    // instead of being cut off mid-word to protect a neighbour that is no
    // longer beside it.
    <div data-testid="tag-focus-line" role="status" className="flex flex-wrap items-center gap-2">
      {/* The chip is rendered in its own tag colour, so the line and the
          ringed chip on the stop you clicked are visibly the same object. */}
      <span
        className={cn("inline-flex shrink-0 items-center rounded-sm px-2 py-0.5 text-xs font-semibold", TAG_CHIP_CLASS[focusedTag])}
      >
        {TAG_LABEL[focusedTag]}
      </span>
      <Text as="span" variant="secondary">
        in focus — everything else is dimmed
      </Text>
      <Button
        variant="ghost"
        size="sm"
        onClick={clearFocusedTag}
        // The visible word is "Clear"; the accessible name says what it
        // clears, because "Clear" alone is meaningless out of the line's
        // visual context and there are other clearable things on this page.
        //
        // Deliberately NOT the chip's own `Stop focusing on meal` hint, which
        // is what this said first: a focused board renders that hint on every
        // chip carrying the tag — 34 of them on the Japan fixture — so this
        // button was the 34th control on the page with an identical accessible
        // name, and no screen-reader user could tell the one that clears from
        // the thirty-three that toggle. Caught by the `/demo` walk, where
        // Playwright's strict mode refused the ambiguity outright.
        aria-label={`Clear ${focusedTag} focus`}
        className="shrink-0"
      >
        <X className="size-3.5" aria-hidden />
        Clear
      </Button>
    </div>
  );
}
