"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

// The server renders "online": a page that reached the reader was served, and
// guessing offline would flash "Hold until online" at everyone on hydration.
/**
 * Whether the browser believes it has a connection — `navigator.onLine`, kept
 * current by the `online` / `offline` events. A `false` is reliable; a `true`
 * only means "not known to be offline", which is why a post that fails anyway
 * still surfaces its own error.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
