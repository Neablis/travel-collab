"use client";

import { useEffect, useState } from "react";

// 768px is the line the rest of this app already draws between "narrow but
// still a shrinkable plan" and "phone" — see `.assistant-rail` and
// `.unscheduled-rack` in globals.css, and SPEC §13's mobile-foundations
// framing. Reused here rather than picking a new one.
const PHONE_MAX_WIDTH_PX = 767;

/**
 * `true` below 768px. A JS media query rather than a CSS one because the Map
 * lens does not merely restyle at this breakpoint — it mounts a *different*
 * day control (a horizontal strip instead of the geared vertical rail), and
 * the rail's scroll machinery measures and observes real DOM. Rendering both
 * and hiding one with CSS would leave the hidden one's ResizeObserver and
 * scroll listener live against a zero-height box.
 *
 * Starts `false` and corrects in an effect: there is no viewport on the
 * server, and guessing "phone" for everyone would flash the wrong control on
 * every desktop load. `matchMedia` is feature-detected because jsdom does not
 * always ship it — the same guard `LandingHeroArt` uses.
 */
export function useIsPhone(): boolean {
  return useMatches(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
}

// Where the trip board stops being wide enough to give the assistant a column.
// KI-2026-09-24-j measured it: docked at 820px, the board kept about 440px —
// one and a half day columns. 1100 is the line M39 D3 draws (critique §3b,
// "two columns at 820, three at 1024"), and the `narrow` e2e project already
// sits on it as the narrowest width the docked contract is held at.
const DOCK_MIN_WIDTH_PX = 1100;

/**
 * `true` from 768px up to 1099px — the band where the trip board keeps its
 * full width and the assistant comes up OVER it, whatever shape the reader
 * chose (M39 D3; Mitchell, 2026-10-09: "the band wins"). Same first-paint
 * rule as `useIsPhone`, for the same reason: starts `false`, corrects in an
 * effect, so only a mount point that cannot exist at first paint may branch
 * on it (`AssistantRail`'s `presentation` note).
 */
export function useIsTabletWidth(): boolean {
  return useMatches(`(min-width: ${PHONE_MAX_WIDTH_PX + 1}px) and (max-width: ${DOCK_MIN_WIDTH_PX - 1}px)`);
}

/**
 * `true` under a finger (`pointer: coarse`) — the same line the CSS
 * `pointer-coarse:` variant draws, for a surface that has to put something in
 * a different PLACE rather than restyle it (the river block's tag chips: a
 * hover reveal under a mouse, part of the title row under a finger). Same
 * first-paint rule as `useIsPhone`: starts `false`, corrects in an effect.
 */
export function useIsCoarsePointer(): boolean {
  return useMatches("(pointer: coarse)");
}

function useMatches(media: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(media);
    const sync = () => setMatches(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, [media]);

  return matches;
}
