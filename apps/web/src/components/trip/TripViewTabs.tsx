"use client";

import { TabStrip } from "@/components/ui/tab-strip";
import { useLens } from "./context/LensRouter";

// Handoff `current/…dc.html:2469`: exactly four peer views. The app's lens
// system still has six (LensRouter is untouched — no lens added, removed or
// merged, per ADR-018/M10's guardrail); Itinerary, Daily overview and Full trip
// keep working via their ?lens= URLs but are no longer in the nav. Recorded in
// docs/known-issues.md. This replaces the three-tabs-plus-"More"-popover
// arrangement, whose trigger relabelled itself to the active lens and left the
// strip showing no selection at all in Map view.
type PrimaryTab = "Timeline" | "Day columns" | "Calendar" | "Map";

const PRIMARY_TABS: readonly { value: PrimaryTab; label: string }[] = [
  { value: "Timeline", label: "Timeline" },
  { value: "Day columns", label: "Day columns" },
  { value: "Calendar", label: "Calendar" },
  { value: "Map", label: "Map" },
];

export function TripViewTabs() {
  const { lens, view, setLens, setLensAndView } = useLens();

  const primaryValue: PrimaryTab | undefined =
    lens === "Board"
      ? "Day columns"
      : lens === "Map"
        ? "Map"
        : lens === "Schedule" && view === "Timeline"
          ? "Timeline"
          : lens === "Schedule" && view === "Calendar"
            ? "Calendar"
            : undefined;

  const selectPrimary = (value: PrimaryTab) => {
    if (value === "Day columns") return setLens("Board");
    if (value === "Map") return setLens("Map");
    setLensAndView("Schedule", value === "Calendar" ? "Calendar" : "Timeline");
  };

  return <TabStrip value={primaryValue} onValueChange={selectPrimary} options={PRIMARY_TABS} aria-label="Trip view" />;
}
