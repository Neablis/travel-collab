"use client";
import { createContext, useContext } from "react";
import type { TripDetail, PageContext } from "@tc/contracts";

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
