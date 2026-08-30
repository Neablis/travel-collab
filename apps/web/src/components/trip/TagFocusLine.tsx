"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { TAG_CHIP_CLASS, TAG_LABEL } from "@/components/board/activityTags";
import { cn } from "@/lib/cn";
import { useFocus } from "./context/FocusProvider";

/**
 * SPEC §11: *"When focus is active, a line beside the view tabs names the tag
 * and offers Clear."*
 *
 * It sits beside `TripViewTabs` rather than above the lens content because
 * focus is cross-lens state — it survives every tab in that strip — and a line
 * that moved or vanished per lens would read as belonging to whichever lens
 * was showing.
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
    <div data-testid="tag-focus-line" role="status" className="flex min-w-0 items-center gap-2">
      {/* The chip is rendered in its own tag colour, so the line and the
          ringed chip on the stop you clicked are visibly the same object. */}
      <span
        className={cn("inline-flex shrink-0 items-center rounded-sm px-2 py-0.5 text-xs font-semibold", TAG_CHIP_CLASS[focusedTag])}
      >
        {TAG_LABEL[focusedTag]}
      </span>
      <Text as="span" variant="secondary" className="min-w-0 truncate">
        in focus — everything else is dimmed
      </Text>
      <Button
        variant="ghost"
        size="sm"
        onClick={clearFocusedTag}
        // The visible word is "Clear"; the accessible name says what it
        // clears, because "Clear" alone is meaningless out of the line's
        // visual context and there are other clearable things on this page.
        aria-label={`Stop focusing on ${focusedTag}`}
        className="shrink-0"
      >
        <X className="size-3.5" aria-hidden />
        Clear
      </Button>
    </div>
  );
}
