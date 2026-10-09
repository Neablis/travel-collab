"use client";

import { useSyncExternalStore } from "react";
import { installPromptStore, type InstallRoute } from "@/lib/installPrompt";

const noSubscription = () => () => {};

/**
 * How this browser installs Caesura — `"prompt"`, `"ios"` or `null` — kept
 * current as the browser's install events arrive, plus the native prompt.
 *
 * `null` on the server and through hydration, so nothing that offers to
 * install is in the server markup: whether this browser can is a fact only the
 * browser has.
 */
export function useInstallPrompt(): {
  route: InstallRoute;
  prompt: () => Promise<"accepted" | "dismissed" | null>;
} {
  const store = installPromptStore();
  const route = useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    () => store?.route() ?? null,
    () => null,
  );
  return { route, prompt: store?.prompt ?? (async () => null) };
}
