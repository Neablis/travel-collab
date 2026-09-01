"use client";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ActivityTag } from "@tc/contracts";

/**
 * How the current `focusedDay` came to be focused.
 *
 * `"explicit"` — somebody picked it: a day chip, a day column's title, the map
 * rail, or the timeline appending a day and scrolling to it.
 * `"scroll"` — they scrolled or arrowed past it and the header followed.
 *
 * The distinction exists for exactly one reason, and it is not cosmetic: the
 * timeline scrolls the focused day into view whenever it changes. Feeding a
 * scroll-derived focus back into that effect is a loop — scroll moves the
 * focus, the focus scrolls the page, the page moves the focus. Consumers that
 * MOVE the viewport check this; consumers that only render the selection
 * (the chips, the columns' rings, the assistant's scope line) do not care.
 */
export type FocusOrigin = "explicit" | "scroll";

type FocusCtx = {
  focusedDay: number | null;
  setFocusedDay: (i: number | null) => void;
  /**
   * The reading position, as scrolling or arrowing reports it.
   *
   * Mitchell, 2026-09-01: *"Scrolling down the timeline or Left/Right in the
   * days column should change the selected day in the header bar."* It is the
   * same state the chips already ring rather than a second, softer indicator —
   * the request was for the selection to move, not for a second marker beside
   * it — so this is `setFocusedDay` with a different origin, not a different
   * value.
   *
   * The design's own model splits these in two (`focus` for the indicator,
   * `focused` for the scope, `dc.html:3630-3666`, where scrolling CLEARS the
   * scope). Deliberately not adopted: two day states would mean every surface
   * deciding which one it means, and the assistant's "Looking at Day 3" is
   * arguably more right following the day you are reading than pinned to one
   * you picked and scrolled away from.
   */
  setScrolledDay: (i: number) => void;
  /** Where `focusedDay`'s current value came from. See `FocusOrigin`. */
  focusOrigin: FocusOrigin;
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
  const [day, setDay] = useState<{ index: number | null; origin: FocusOrigin }>({
    index: null,
    origin: "explicit",
  });
  const focusedDay = day.index;
  const focusOrigin = day.origin;
  const [focusedTag, setFocusedTag] = useState<ActivityTag | null>(null);

  const setFocusedDay = useCallback((index: number | null) => {
    setDay({ index, origin: "explicit" });
  }, []);

  // Functional, and the bail-out is inside it: a scroll spy fires on every
  // frame of a scroll, and returning the SAME object for an unchanged index is
  // what keeps this from re-rendering the whole board sixty times a second.
  // Comparing outside the updater would read a stale `day` from the closure the
  // handler was registered with.
  const setScrolledDay = useCallback((index: number) => {
    setDay((current) =>
      current.index === index && current.origin === "scroll"
        ? current
        : { index, origin: "scroll" },
    );
  }, []);

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
    () => ({
      focusedDay,
      setFocusedDay,
      setScrolledDay,
      focusOrigin,
      focusedTag,
      toggleFocusedTag,
      clearFocusedTag,
    }),
    [focusedDay, setFocusedDay, setScrolledDay, focusOrigin, focusedTag, toggleFocusedTag, clearFocusedTag],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
