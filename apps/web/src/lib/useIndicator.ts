"use client";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * One sliding indicator for a tab list (M54 decision 11): measures the active
 * trigger against its list and writes the result onto the indicator as custom
 * properties — `--indicator-x`, `--indicator-y`, `--indicator-w` and `--indicator-h` in px, and
 * `--indicator-scale`, the width as a plain number for a 1px line drawn with
 * `scaleX` — which the `.tab-indicator` rules in globals.css turn into a
 * `transform`. Written straight onto the node, so a resize re-places it
 * without a render.
 *
 * `ready` is false until the first measurement, which the server's HTML and
 * the hydrating paint never have; a caller draws the active trigger's own
 * look until then, so the selection is never missing for a paint.
 */
export function useIndicator<K extends string>(list: RefObject<HTMLElement | null>, active: K | null | undefined) {
  const indicator = useRef<HTMLSpanElement>(null);
  const triggers = useRef(new Map<K, HTMLElement>());
  const [ready, setReady] = useState(false);

  const trigger = (key: K) => (node: HTMLElement | null) => {
    if (node === null) triggers.current.delete(key);
    else triggers.current.set(key, node);
  };

  // A layout effect, so a switch is placed before the paint that shows it.
  useLayoutEffect(() => {
    const listNode = list.current;
    const mark = indicator.current;
    if (listNode === null || mark === null) return;
    const node = active == null ? undefined : triggers.current.get(active);
    mark.hidden = node === undefined;

    const place = () => {
      if (node === undefined) return;
      const from = listNode.getBoundingClientRect();
      const box = node.getBoundingClientRect();
      // Scroll offsets, so the indicator is placed in the list's content and
      // scrolls with a strip that overflows.
      mark.style.setProperty("--indicator-x", `${box.left - from.left - listNode.clientLeft + listNode.scrollLeft}px`);
      mark.style.setProperty("--indicator-y", `${box.top - from.top - listNode.clientTop + listNode.scrollTop}px`);
      mark.style.setProperty("--indicator-w", `${box.width}px`);
      mark.style.setProperty("--indicator-h", `${box.height}px`);
      mark.style.setProperty("--indicator-scale", `${box.width}`);
      if (mark.dataset.placed === undefined) {
        // The transition is switched on only once the first place is drawn:
        // the read flushes styles, so the indicator arrives there rather than
        // sliding in from the list's left edge.
        mark.getBoundingClientRect();
        mark.dataset.placed = "";
      }
    };
    place();
    // Once there is a place, the indicator takes the active look over from
    // the trigger.
    setReady(true);

    let live = true;
    // The first measure can come before the web font swaps in, and a label in
    // the fallback face is another width. jsdom has neither of these.
    void document.fonts?.ready.then(() => {
      if (live) place();
    });
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
    observer?.observe(listNode);
    if (node !== undefined) observer?.observe(node);
    // A trigger drawn inside its tab (the phone tab bar's pill, in a `flex-1`
    // link) moves when the tab resizes around it: Ask joining the bar
    // narrows every tab and resizes neither the bar nor the pill.
    const tab = node?.parentElement;
    if (tab != null && tab !== listNode) observer?.observe(tab);
    return () => {
      live = false;
      observer?.disconnect();
    };
  }, [list, active]);

  return { indicator, trigger, ready };
}
