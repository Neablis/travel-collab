"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` (M39 Part 4, D4) once the page has hydrated. Renders
 * nothing.
 *
 * **Production builds only**, where installing is the point. The worker has no
 * fetch listener (KI-2026-10-09-e), so it serves nothing in either lane; Next
 * inlines `NODE_ENV` at build time, so the dev bundle carries no registration
 * at all.
 *
 * `updateViaCache: "none"` makes every update check fetch `sw.js` past the HTTP
 * cache, whatever headers it was served with, so a fixed worker reaches every
 * installed copy on its next navigation.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch((error: unknown) => {
      // Not installable is all a failure costs; the page itself is unaffected.
      console.warn("service worker registration failed", error);
    });
  }, []);
  return null;
}
