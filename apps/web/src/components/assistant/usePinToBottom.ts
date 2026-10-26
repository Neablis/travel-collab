"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * **Pin a scrollport to its own bottom when `deps` change.**
 *
 * This exists because `Transcript` used to scroll itself, with
 * `scrollIntoView({ block: "end" })` on a trailing div — and it owns no
 * scrollport. `AssistantRail`'s `overflow-y-auto` column does, and the New-trip
 * sheet's thread will. `scrollIntoView` moves **every** scrollable ancestor
 * rather than the one that was meant, which is why SPEC §30.6 bans it repo-wide
 * and why KI-2026-09-13-a was a bug in that family. Dropped into a second
 * scrollport it would have fought the sheet's own pinning.
 *
 * So the job moves to whoever owns the scrollport, and becomes explicit about
 * which element it means.
 *
 * **Why a transcript has to scroll at all:** a streaming answer arrives below
 * the fold, and a view that does not follow it reads as one that has stopped.
 * That was the original reason for the effect and it has not changed.
 *
 * `deps` is spread into the effect's dependency list rather than passed whole,
 * so an unchanged thread does not re-pin — a reader who has scrolled up to
 * re-read something keeps their place until the next turn actually arrives.
 *
 * New content glides into view rather than jumping (M54 decision 13). The
 * first pin that finds anything to scroll goes at once: opening on a loaded
 * thread, or a history landing in a panel that opened still loading, is not
 * new content, and a glide from the top would scroll the reader through all
 * of it. Reduced motion always goes at once, where a glide is movement nobody
 * asked for (spec §3).
 *
 * A glide under way is left to finish. A streamed answer changes the thread
 * on every delta, and restarting the ease each time trails the text in a
 * stutter, so the pins that came during it are paid by one more glide once it
 * ends, or after a second if `scrollend` never says so. Without `scrollend`
 * at all, every pin glides as it comes.
 */
export function usePinToBottom(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  // Set once a pin has found something to scroll.
  const opened = useRef(false);
  // The node whose glide is under way, and whether a pin came during it.
  const gliding = useRef<HTMLElement | null>(null);
  const owed = useRef(false);
  useEffect(() => {
    const node = ref.current;
    // Null on the first paint and after unmount. Nothing to pin, and the
    // consumer should not have to guard its own ref to call this.
    if (node === null) return;
    if (gliding.current === node) {
      owed.current = true;
      return;
    }
    const pin = () => {
      const below = node.scrollHeight - node.clientHeight - node.scrollTop;
      const smooth = opened.current && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (below > 0) opened.current = true;
      // jsdom has no element `scrollTo`; the plain assignment still pins there.
      if (typeof node.scrollTo !== "function") {
        node.scrollTop = node.scrollHeight;
        return;
      }
      node.scrollTo({ top: node.scrollHeight, behavior: smooth ? "smooth" : "instant" });
      // Already at the bottom, a glide goes nowhere and no `scrollend` comes.
      // Under a pixel counts: at a fractional zoom or device pixel ratio
      // `scrollTop` is fractional, and a view at the bottom reads as a
      // fraction short of it (PR 605 review).
      if (!smooth || below < 1 || !("onscrollend" in node)) return;
      gliding.current = node;
      const ended = () => {
        clearTimeout(lapse);
        node.removeEventListener("scrollend", ended);
        gliding.current = null;
        if (!owed.current) return;
        owed.current = false;
        pin();
      };
      // A `scrollend` that never comes (the node hidden mid-glide, a scroll
      // the browser dropped) would hold every later pin back for good. A
      // glide is long over in a second.
      const lapse = setTimeout(ended, 1000);
      node.addEventListener("scrollend", ended, { once: true });
    };
    pin();
    // The dep list IS the argument: the caller says what "new content" means
    // for its own thread, and `ref` is stable across renders by construction,
    // so the rule cannot check either statically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
