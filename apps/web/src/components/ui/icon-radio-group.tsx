"use client";

import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Button } from "./button";

/** One choice in an `IconRadioGroup`: the value, the name a screen reader hears and the tooltip shows, and its icon. */
export type IconRadioOption<T extends string> = { value: T; label: string; Icon: LucideIcon };

/**
 * A row of icon-only radios that can also be left with nothing chosen — the
 * shape a stop's kind detail takes (a transit stop's mode, a pending stop's
 * reason; Mitchell 2026-09-26: *"I prefer the icon buttons so use that for both
 * places it has a kind"*).
 *
 * Extracted from `TravelModePicker` (#230) when the second caller arrived, so
 * the two cannot drift. What it guarantees:
 *
 * - **Every icon is named.** `aria-label` and `title` both carry the label, so
 *   a screen reader hears what a sighted user reads off the icon, and a hover
 *   says it in words. The group carries its own name for the same reason.
 * - **Clicking the chosen option again clears it back to `null`.** A native
 *   radio group has no way back to "nothing chosen"; this is that way.
 * - **One tab stop, arrows move the choice** (roving `tabIndex`), matching
 *   ReportDialog's `ReasonGroup`.
 *
 * Not `SegmentedControl`: that always has a value and shows words; this may be
 * empty and shows icons.
 */
export function IconRadioGroup<T extends string>({
  value,
  onValueChange,
  options,
  "aria-label": ariaLabel,
}: {
  value: T | null;
  onValueChange: (next: T | null) => void;
  options: readonly IconRadioOption<T>[];
  "aria-label": string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex((o) => o.value === value);
  const focusIndex = Math.max(0, chosen);
  const moveTo = (next: number) => {
    const i = (next + options.length) % options.length;
    onValueChange(options[i]!.value);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="flex flex-wrap gap-1.5">
      {options.map(({ value: option, label, Icon }, i) => {
        const on = value === option;
        return (
          <Button
            key={option}
            ref={(el) => {
              refs.current[i] = el;
            }}
            variant={on ? "primary" : "secondary"}
            size="icon"
            role="radio"
            aria-checked={on}
            aria-label={label}
            title={label}
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onValueChange(on ? null : option)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                moveTo(i + 1);
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                moveTo(i - 1);
              }
            }}
          >
            <Icon className="size-4" aria-hidden />
          </Button>
        );
      })}
    </div>
  );
}
