"use client";
import { useEffect, type RefObject } from "react";

/**
 * Focus `ref` two animation frames after mount, when `when` is true.
 *
 * **Not `autoFocus`.** The controls that ask for this are the next step after
 * an insert (the link widgets' target picker and address box, ADR-056), and the
 * insert ends in the editor's own `focus()` — which TipTap lands on a later
 * animation frame, taking focus straight back from an `autoFocus` that fired on
 * mount. Seen in the M30 e2e: the picker mounted focused and read "inactive" a
 * frame later. Two frames puts this after the editor.
 */
export function useLateFocus(ref: RefObject<HTMLElement | null>, when: boolean): void {
  useEffect(() => {
    if (!when) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => ref.current?.focus());
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
    // Once per mount: a re-render must not pull focus back into the box.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
