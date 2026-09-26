"use client";

import { useRef, type KeyboardEvent } from "react";

/**
 * **The ARIA radio-group keyboard contract, for a row of `role="radio"` buttons**:
 * one tab stop (roving `tabIndex`: the chosen option, or the first when nothing
 * is chosen), and the arrow keys move the choice AND the focus to the next or
 * previous option, wrapping at both ends. Right/Down is next, Left/Up previous.
 *
 * Shared by `SegmentedControl` and `IconRadioGroup` so the two cannot drift —
 * the stop editor's Kind lost its keyboard when it moved from a select to a
 * `SegmentedControl` that had none (PR 242 review). Spread `radioProps(i)` onto
 * the i-th option.
 */
export function useRovingRadio<T>(
  values: readonly T[],
  value: T | null,
  choose: (next: T) => void,
): (index: number) => {
  ref: (el: HTMLButtonElement | null) => void;
  tabIndex: 0 | -1;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
} {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusIndex = Math.max(0, values.indexOf(value as T));
  const moveTo = (next: number) => {
    const i = (next + values.length) % values.length;
    choose(values[i]!);
    refs.current[i]?.focus();
  };
  return (index) => ({
    ref: (el) => {
      refs.current[index] = el;
    },
    tabIndex: index === focusIndex ? 0 : -1,
    onKeyDown: (e) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        moveTo(index + 1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        moveTo(index - 1);
      }
    },
  });
}
