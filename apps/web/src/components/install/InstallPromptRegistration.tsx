"use client";

import { installPromptStore, recordVisit } from "@/lib/installPrompt";

// **At module scope, not in an effect.** Chromium fires `beforeinstallprompt`
// once, as soon as the page qualifies — which can be before React has hydrated
// and run a single effect, and a listener attached after it has fired never
// hears it. This module is evaluated with the root layout's client chunk,
// before hydration. The same load counts as today's visit for the phone nudge.
if (typeof window !== "undefined") {
  installPromptStore();
  recordVisit();
}

/**
 * Mounted once, in the root layout, so every route's client bundle carries the
 * module above. Renders nothing.
 */
export function InstallPromptRegistration() {
  return null;
}
