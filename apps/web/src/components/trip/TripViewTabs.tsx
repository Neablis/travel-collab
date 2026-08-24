"use client";

import { TabStrip } from "@/components/ui/tab-strip";
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

export function TripViewTabs() {
  const { lens, view, setLens, setLensAndView } = useLens();

  const primaryValue: PrimaryTab =
    lens === "Board" ? "Day columns" : lens === "Map" ? "Map" : view === "Calendar" ? "Calendar" : "Timeline";

  const selectPrimary = (value: PrimaryTab) => {
    if (value === "Day columns") return setLens("Board");
    if (value === "Map") return setLens("Map");
    setLensAndView("Schedule", value === "Calendar" ? "Calendar" : "Timeline");
  };

  return <TabStrip value={primaryValue} onValueChange={selectPrimary} options={PRIMARY_TABS} aria-label="Trip view" />;
}
