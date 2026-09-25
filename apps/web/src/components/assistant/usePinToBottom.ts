"use client";

import { useEffect, type RefObject } from "react";

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
 */
export function usePinToBottom(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useEffect(() => {
    const node = ref.current;
    // Null on the first paint and after unmount. Nothing to pin, and the
    // consumer should not have to guard its own ref to call this.
    if (node === null) return;
    node.scrollTop = node.scrollHeight;
    // The dep list IS the argument: the caller says what "new content" means
    // for its own thread, and `ref` is stable across renders by construction,
    // so the rule cannot check either statically.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
