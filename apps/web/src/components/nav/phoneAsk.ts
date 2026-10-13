"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

// **The phone's Ask lives in the bottom tab bar** (Mitchell, 2026-10-10
// preview pass: the phone trip header was "way too crowded", and he chose
// "give the ai button a place on bottom toolbar"). The bar and the assistant
// it opens are in different trees: `PhoneTabBar` is mounted by
// `(app)/layout.tsx`, while the assistant's visibility belongs to the screen
// that renders it (`TripBoardScreen`, `NotebookScreen`, `PageScreen`), several
// levels below. No context spans both, so the screen registers its opener
// here and the bar reads it.
//
// One entry at a time, and the latest registration wins: at most one trip
// screen is mounted, and a screen that unmounts takes its entry with it, so
// the bar never offers an Ask with nothing behind it (`/demo`, a locked
// notebook, the account pages). The entry is a value, not a flag the bar
// holds — the route still decides which tabs exist (`tabsForScope`).

/**
 * What the tab bar's Ask item needs: whether the assistant is up, and how to
 * bring it up. `onAsk` brings it up and sends `text`, for ⌘K's *Ask: <text>*
 * (M45 D6); a screen that offers none gets no such row.
 */
export type PhoneAskEntry = { open: boolean; onOpen: () => void; onAsk?: (text: string) => void };

let entry: PhoneAskEntry | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Registers `next` as the bar's Ask, answering the call that takes it back
 * again. Taking back an entry that has since been replaced leaves the newer one.
 */
export function registerPhoneAsk(next: PhoneAskEntry): () => void {
  entry = next;
  emit();
  return () => {
    if (entry !== next) return;
    entry = null;
    emit();
  };
}

/** The registered Ask, or `null` where this screen offers none. */
export function usePhoneAsk(): PhoneAskEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => entry,
    // The server render has no screen registered yet: no item for one paint,
    // which is the same answer `/demo` gets for good.
    () => null,
  );
}

/**
 * Offers this screen's assistant as the tab bar's Ask while mounted. `onOpen`
 * `undefined` offers none; `onAsk`, sending a question as it opens, is
 * optional beside it. Either may be a fresh function each render: the entry
 * calls whichever is latest, so only `open`, or whether each is offered,
 * changing re-registers.
 */
export function usePhoneAskEntry(onOpen: (() => void) | undefined, open: boolean, onAsk?: (text: string) => void): void {
  const latest = useRef({ onOpen, onAsk });
  useEffect(() => {
    latest.current = { onOpen, onAsk };
  });
  const offered = onOpen !== undefined;
  const asks = onAsk !== undefined;
  useEffect(() => {
    if (!offered) return;
    return registerPhoneAsk({
      open,
      onOpen: () => latest.current.onOpen?.(),
      ...(asks ? { onAsk: (text: string) => latest.current.onAsk?.(text) } : {}),
    });
  }, [offered, asks, open]);
}
