"use client";

import Link from "next/link";
import type { ActivityTag } from "@tc/contracts";
import { cn } from "@/lib/cn";
import { TAG_CHIP_CLASS, TAG_LABEL, tagFocusHint } from "@/lib/activityTags";

/**
 * A stop's tag chips — SPEC §11's click-a-chip-to-focus, on the river's block.
 *
 * Moved verbatim out of the day column's old `ActivityCard` (M29 part 2), which
 * shared it until PR #269 retired that card; the reasoning each line carried
 * there is kept with it.
 *
 * Each label carries a trailing space: the chips are flex items with only a
 * CSS gap between them, so an extracted snippet ran them together
 * ("FoodBeachDrinksSightTour"). The space collapses visually inside the pill,
 * so the chips look unchanged, and it is what separates them in text.
 */
export function StopTagChips({
  activityId,
  tags,
  focusedTag,
  onToggleTag,
  hrefOf,
}: {
  activityId: string;
  tags: readonly ActivityTag[];
  focusedTag: ActivityTag | null;
  /** Withheld → the chips stay plain text (M18's shipped behaviour). */
  onToggleTag?: (tag: ActivityTag) => void;
  /** A chip's page, for a chip that is a way somewhere (M42's tag pages); null leaves that chip text. */
  hrefOf?: (tag: ActivityTag) => string | null;
}) {
  if (tags.length === 0) return null;
  return (
    <span
      data-testid={`tag-chips-${activityId}`}
      // Linked chips wrap with a row gap that keeps one 44px reach from
      // overlapping the next row's on a phone, as a Discover card's city chips do.
      className={cn("flex flex-wrap", hrefOf === undefined ? "gap-1.5" : "gap-x-1.5 gap-y-6 md:gap-y-1.5")}
    >
      {tags.map((tag) => {
        const chipClass = cn(
          "inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-semibold",
          TAG_CHIP_CLASS[tag],
        );
        const href = hrefOf?.(tag) ?? null;
        if (href !== null) {
          return (
            <Link
              key={tag}
              href={href}
              data-testid={`tag-chip-${tag}`}
              // The page the chip names, in its new title family ("Beach
              // days worth borrowing"), not the old "playbooks" one.
              aria-label={`${TAG_LABEL[tag]} days`}
              // The toggle's 44px reach around a 20px chip, below.
              className="group/chip inline-flex min-h-11 -my-3 items-center fine:my-0 fine:min-h-0"
            >
              <span className={cn(chipClass, "group-hover/chip:underline")}>{TAG_LABEL[tag]}{" "}</span>
            </Link>
          );
        }
        if (!onToggleTag) {
          return (
            <span key={tag} data-testid={`tag-chip-${tag}`} className={chipClass}>
              {TAG_LABEL[tag]}{" "}
            </span>
          );
        }
        const isFocused = focusedTag === tag;
        return (
          // eslint-disable-next-line no-restricted-syntax -- a tag chip is not a Button-variant action: every buttonVariants() variant hard-codes a hover background (`hover:bg-moss`, `hover:bg-brand-hover`) plus `disabled:opacity-50`, and a chip's whole job is to keep its own tag colour — the hover class would repaint it moss and twMerge cannot drop a `hover:` class the chip does not itself set. Same escape hatch, and same reasoning, as MapRail's day rows.
          <button
            key={tag}
            type="button"
            data-testid={`tag-chip-${tag}`}
            // `aria-pressed` rather than a role of its own: this is a toggle
            // whose off state is "no tag focused", which is exactly what a
            // toggle button announces. The accessible name is the hint, not the
            // bare label — "Meal" alone tells a screen-reader user the chip
            // exists and nothing about what pressing it does.
            aria-pressed={isFocused}
            aria-label={tagFocusHint(tag, isFocused)}
            title={tagFocusHint(tag, isFocused)}
            onClick={(event) => {
              // The card and the block are drag sources, and the block is also
              // a click target that opens the editor; without this a chip click
              // also does whatever the surface below it does.
              event.stopPropagation();
              onToggleTag(tag);
            }}
            // **A 44px target, a 20px chip** — SPEC §13.1 on a phone,
            // KI-2026-09-24-m. The button is the hit area and the inner span is
            // the chip, so the card keeps its density: `-my-3` hands back
            // exactly the 24px `min-h-11` adds. `md:` releases it on the same
            // line `PHONE_TOUCH` does.
            // A NAMED group: the river block is itself a `group`, and a bare
            // `group-hover` below would fade every chip whenever the block
            // under the pointer was hovered rather than the chip.
            className="group/chip inline-flex min-h-11 -my-3 cursor-pointer items-center fine:my-0 fine:min-h-0"
          >
            {/* `relative` so that when the chips wrap, a visible chip paints —
                and so hit-tests — above the next row's invisible reach. */}
            <span
              className={cn(
                chipClass,
                "relative group-hover/chip:opacity-80",
                // `ring-inset`: a chip sits inside rows that clip, and an outset
                // ring on the first one loses its left edge.
                isFocused && "ring-2 ring-brand ring-inset",
              )}
            >
              {TAG_LABEL[tag]}{" "}
            </span>
          </button>
        );
      })}
    </span>
  );
}
