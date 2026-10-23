"use client";
import { useEffect, useState } from "react";
import type { TripNowClock } from "@tc/pages";

/**
 * The reader's clock — the time and the device's zone — read again each minute
 * and when the tab comes back into view, so a countdown or *now and next* left
 * open keeps up. `null` until the first client frame.
 *
 * **Read in an effect, never during render**: a server-rendered component (Home's hero)
 * that read the time while rendering would differ from its first client pass,
 * which React reports as a hydration error.
 */
export function useMinuteClock(): TripNowClock | null {
  const [clock, setClock] = useState<TripNowClock | null>(null);
  useEffect(() => {
    const read = () => setClock({ at: Date.now(), deviceZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
    const onVisible = () => {
      if (document.visibilityState === "visible") read();
    };
    read();
    const timer = window.setInterval(read, 60_000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
  return clock;
}
