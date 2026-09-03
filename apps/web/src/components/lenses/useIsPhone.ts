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
  const [isPhone, setIsPhone] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(`(max-width: ${PHONE_MAX_WIDTH_PX}px)`);
    const sync = () => setIsPhone(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);

  return isPhone;
}
