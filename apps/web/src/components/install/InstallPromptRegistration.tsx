"use client";

import { installPromptStore, recordVisit } from "@/lib/installPrompt";

// **At module scope, not in an effect** — the earliest the app's own code runs,
// so the store is listening before anything renders that reads it. An install
// offer fired earlier still is held by the root layout's inline head script
// (`EARLY_INSTALL_LISTENER`) and adopted as the store is created here. The
// same load counts as today's visit for the phone nudge.
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
