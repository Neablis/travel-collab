"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ActivityTag } from "@tc/contracts";

type FocusCtx = {
  focusedDay: number | null;
  setFocusedDay: (i: number | null) => void;
  /**
   * SPEC §11's tag focus: the one tag every lens dims against, or null.
   *
   * It lives here, beside `focusedDay`, because both are "what the viewer is
   * currently narrowing to" and both must outlive a lens switch — this
   * provider is mounted above `LensRouter` on the trip page and on `/demo`,
   * so the state survives switching tabs by construction rather than by a URL
   * round-trip. They are deliberately NOT one value: a day focus and a tag
   * focus are independently settable and independently clearable (M18b's exit
   * gate: "Focus survives a lens switch, and is not confused with day focus"),
   * and folding them into one `focus: {kind, value}` union would make picking
   * a day silently drop a tag the viewer never cleared.
   */
  focusedTag: ActivityTag | null;
  /** Sets the tag, or clears it when it is already the focused one. */
  toggleFocusedTag: (tag: ActivityTag) => void;
  clearFocusedTag: () => void;
};
const Ctx = createContext<FocusCtx | null>(null);

export function useFocus(): FocusCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFocus outside FocusProvider");
  return v;
}

export function FocusProvider({ children }: { children: React.ReactNode }) {
  const [focusedDay, setFocusedDay] = useState<number | null>(null);
  const [focusedTag, setFocusedTag] = useState<ActivityTag | null>(null);

  // Single focus, one tag at a time (SPEC §11 — "multi-select was the part
  // that earned its keep least"), expressed as a toggle rather than a plain
  // setter so the "clicking the same chip clears it" rule lives in ONE place
  // instead of at every chip. The functional update is what makes that true
  // for two chips clicked in the same tick.
  const toggleFocusedTag = useCallback((tag: ActivityTag) => {
    setFocusedTag((current) => (current === tag ? null : tag));
  }, []);
  const clearFocusedTag = useCallback(() => setFocusedTag(null), []);

  const value = useMemo(
    () => ({ focusedDay, setFocusedDay, focusedTag, toggleFocusedTag, clearFocusedTag }),
    [focusedDay, focusedTag, toggleFocusedTag, clearFocusedTag],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
