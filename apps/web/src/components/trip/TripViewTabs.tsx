"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { TabStrip } from "@/components/ui/tab-strip";
import { useIsPhone } from "@/components/lenses/useIsPhone";
import { useLens } from "./context/LensRouter";

// Handoff `current/…dc.html:2469`: exactly four peer views. This replaces the
// three-tabs-plus-"More"-popover arrangement, whose trigger relabelled itself
// to the active lens and left the strip showing no selection at all in Map
// view. The Itinerary, Daily overview and Full-trip lenses that popover used to
// carry are retired (KI-20) rather than re-homed, so these four tabs now cover
// every lens LensRouter accepts and `primaryValue` below is total — every
// (lens, view) pair maps to exactly one tab, and no tab-less state exists.
type PrimaryTab = "Timeline" | "Day columns" | "Calendar" | "Map";

const PRIMARY_TABS: readonly { value: PrimaryTab; label: string }[] = [
  { value: "Timeline", label: "Timeline" },
  { value: "Day columns", label: "Day columns" },
  { value: "Calendar", label: "Calendar" },
  { value: "Map", label: "Map" },
];

/**
 * SPEC §10, "**Two views, not four.** Day columns and Calendar exist to show
 * *density*, which a phone cannot show honestly." On a phone the strip itself
 * is gone (TripBoardScreen hides it — Plan and Map are bottom-nav tabs now),
 * so nothing can *choose* Board or Calendar there. What is left is the way a
 * phone arrives at one without choosing it: `/trips/<id>` with no query at all,
 * which LensRouter resolves to **Board**. That default — not the URL in
 * general — is what this corrects.
 *
 * **It rewrites the default only. An explicit `?lens=` is obeyed, including
 * `?lens=Board` on a phone.** That line is deliberate, and it is narrower than
 * the first version of this hook, which rewrote any Board/Calendar URL:
 *
 * - The user-facing gap it leaves is small and self-healing. Nothing in the
 *   phone UI can produce a `?lens=Board` link, so reaching one means opening
 *   somebody's desktop link; and the reader is not stuck when they do, because
 *   `PhoneTabBar`'s Plan tab is on screen and points at
 *   `?lens=Schedule&view=Timeline`.
 * - Against that, rewriting an explicit lens means silently discarding a URL a
 *   person is holding — and it broke `m10-growth`'s day-sync spec, which loads
 *   `?lens=Board` at 411px to force ten columns off-screen. That spec is about
 *   day-sync, not about phones; the width is only how it gets the overflow.
 *   Honouring the explicit lens keeps it meaningful. (Re-homing it above the
 *   breakpoint was tried first and is not available: at 800px it fails on a
 *   *pre-existing* defect — with this whole branch reverted, clicking a day
 *   column's header does not hold the selection once ~3 columns are visible;
 *   the scroll-spy drags it back, which is the loop that spec's own comment
 *   says the jump lock exists to break. 411px was masking it.)
 *
 * Two things make the remaining rewrite safe, and each was a way to get it
 * wrong:
 *
 * 1. **A desktop URL is never rewritten.** `useIsPhone` starts `false` on the
 *    server and on the first client paint, and on a desktop it *stays* false —
 *    the effect's guard never passes, so `router.replace` is never called.
 *    The hook's "wrong for one paint" property, which is a problem for
 *    rendering, is exactly the right bias here: the failure mode of guessing
 *    is a desktop user's URL being silently rewritten, and starting `false`
 *    makes that unreachable.
 * 2. **It cannot thrash.** The one write it performs *adds* `?lens=`, so
 *    `hasExplicitLens` is true forever after and the guard can never pass a
 *    second time. There is no write to race the first.
 *
 * `setLensAndView` carries `scroll: false` for LensRouter's documented reason —
 * the lens scrolls itself to the selected day on mount, and Next's default
 * scroll-to-top would land after it and undo it.
 */
function usePhoneTwoViews() {
  const { setLensAndView } = useLens();
  const isPhone = useIsPhone();
  // The RAW param, not `useLens()`'s `lens`. LensRouter folds "no `?lens=` at
  // all" and "`?lens=Board`" into the same value — Board is its fallback — and
  // the difference between those two is the whole of what this hook may act
  // on. Only the first is a default this code chose; the second is a URL a
  // person is holding.
  const hasExplicitLens = useSearchParams().get("lens") !== null;

  useEffect(() => {
    if (!isPhone || hasExplicitLens) return;
    setLensAndView("Schedule", "Timeline");
  }, [isPhone, hasExplicitLens, setLensAndView]);
}

export function TripViewTabs() {
  const { lens, view, setLens, setLensAndView } = useLens();
  usePhoneTwoViews();

  const primaryValue: PrimaryTab =
    lens === "Board" ? "Day columns" : lens === "Map" ? "Map" : view === "Calendar" ? "Calendar" : "Timeline";

  const selectPrimary = (value: PrimaryTab) => {
    if (value === "Day columns") return setLens("Board");
    if (value === "Map") return setLens("Map");
    setLensAndView("Schedule", value === "Calendar" ? "Calendar" : "Timeline");
  };

  return <TabStrip value={primaryValue} onValueChange={selectPrimary} options={PRIMARY_TABS} aria-label="Trip view" />;
}
