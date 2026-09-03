"use client";
import { createContext, useContext } from "react";
import type { TripDetail, PageContext, UserPreferences } from "@tc/contracts";

// Carries the `detail`/`context` that every `macro` NodeView needs to resolve
// itself, from `PageEditor` down to `MacroNodeView` — without threading them
// through TipTap's per-extension `storage` (which isn't reactive: updating it
// doesn't re-render mounted React node views, so a live `detail` refresh
// would go stale inside the editor until the next keystroke touched the
// node). A React context re-renders every subscriber whenever `detail`
// changes, matching how any other read-side data flows into this app.
export interface MacroEditorContextValue {
  detail: TripDetail;
  context: PageContext;
  // The account, which every notebook is in scope of (ADR-037 open question 2).
  // `null` means the preferences request has not landed or failed — the page
  // still opens, and account widgets render "not set up" (decision 6) rather
  // than the notebook refusing to load over a preference fetch.
  user: UserPreferences | null;
  onBindDay?: () => void;
}

export const MacroEditorContext = createContext<MacroEditorContextValue | null>(null);

export function useMacroEditorContext(): MacroEditorContextValue {
  const value = useContext(MacroEditorContext);
  if (!value) {
    throw new Error("useMacroEditorContext must be used within a MacroEditorContext.Provider (PageEditor)");
  }
  return value;
}
