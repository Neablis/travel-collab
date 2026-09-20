"use client";

import { useEffect, useState } from "react";

// 200ms, and the number is the point of this hook.
//
// Mitchell, 2026-09-20: *"i still see a flicker of 'Loading' text in top left
// when i click a trip to open it. It happens too quickly to leave a ui
// comment"* — a bug report whose own wording is the measurement. A state that
// cannot be pointed at is not a state a reader is being informed by; it is a
// flash of layout.
//
// Why a trip open resolves that fast: `TripProvider` starts at
// `status: "loading"` and reads through `cachedRead`, and Home's hero has
// usually *already* fetched the same `TripDetail` for its stats (see the note
// at `TripProvider.tsx:109`). On that path the promise settles in about a
// frame, so the loading branch renders once and is gone.
//
// 200ms rather than the ~100ms often quoted for "instant": below roughly this,
// a placeholder appearing and vanishing reads as a glitch rather than as
// progress, and the reader has not yet begun to wonder. It is deliberately
// NOT one of `Skeleton`'s three stagger bands (0/220/440ms) — those space
// regions apart *once loading is worth showing*, which is a different
// question from whether to show it at all. `[data-sk]` starts at opacity 1,
// so a skeleton behind no gate would flash exactly as the text does.
const SLOW_AFTER_MS = 200;

/**
 * `false` while something has only *just* started loading, `true` once it has
 * been loading long enough that saying so beats staying silent.
 *
 * The contract is one-way per spell: it goes true after the threshold and
 * returns to false only when `loading` itself goes false. A caller can
 * therefore render nothing at all on the fast path — which is the whole point,
 * because the alternative to a flicker is not a nicer flicker, it is an
 * unchanged screen for the 200ms it takes to find out.
 *
 * Deliberately not in `skeleton.tsx`: that module is imported by server
 * components and carries no `"use client"`, and a hook would make it
 * client-only for every one of them.
 */
export function useSlowLoad(loading: boolean, afterMs: number = SLOW_AFTER_MS): boolean {
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    // Reset on the way out, so a second load in the same mount (a retry, or a
    // trip switched without unmounting the board) gets its own fresh window
    // rather than inheriting the last one's `true` and flashing immediately.
    if (!loading) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), afterMs);
    return () => window.clearTimeout(timer);
  }, [loading, afterMs]);

  return slow;
}
