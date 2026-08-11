"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover } from "@/components/ui/popover";
import { TabStrip } from "@/components/ui/tab-strip";
import { useLens, type Lens } from "./context/LensRouter";
import { cn } from "@/lib/cn";

const MORE_LENSES: readonly { value: Lens; label: string }[] = [
  { value: "Map", label: "Map" },
  { value: "Itinerary", label: "Itinerary" },
  { value: "Daily", label: "Daily overview" },
  { value: "Trip", label: "Full trip" },
];

type PrimaryTab = "Timeline" | "Day columns" | "Calendar";
const PRIMARY_TABS: readonly { value: PrimaryTab; label: string }[] = [
  { value: "Timeline", label: "Timeline" },
  { value: "Day columns", label: "Day columns" },
  { value: "Calendar", label: "Calendar" },
];

// Handoff §2: the design's TabStrip has exactly 3 peer views (Timeline / Day
// columns / Calendar). The app's underlying lens system still has all 6
// (LensRouter.tsx is untouched by this component — no lens added, removed,
// or merged, per ADR-018/M10's guardrail): Board, Map, Schedule (which owns
// its own Timeline/Calendar `view`), Itinerary, Daily, Trip. This component
// is presentation-only: it derives which of the 3 design tabs (if any) the
// current lens+view maps to, and tucks the other 4 lenses behind a "More"
// menu instead of exposing all 6 as equal top-level tabs — reachable, not
// primary nav. Replaces the direct `<TabStrip options={LENSES.map(...)}>`
// this screen used to render.
export function TripViewTabs() {
  const { lens, view, setLens, setLensAndView } = useLens();
  const [moreOpen, setMoreOpen] = useState(false);

  const primaryValue: PrimaryTab | undefined =
    lens === "Board"
      ? "Day columns"
      : lens === "Schedule" && view === "Timeline"
        ? "Timeline"
        : lens === "Schedule" && view === "Calendar"
          ? "Calendar"
          : undefined;

  const activeMoreLens = MORE_LENSES.find((m) => m.value === lens) ?? null;

  const selectPrimary = (value: PrimaryTab) => {
    if (value === "Day columns") {
      setLens("Board");
      return;
    }
    setLensAndView("Schedule", value === "Calendar" ? "Calendar" : "Timeline");
  };

  return (
    <div className="flex items-center gap-1.5">
      <TabStrip value={primaryValue} onValueChange={selectPrimary} options={PRIMARY_TABS} aria-label="Trip view" />
      <Popover
        open={moreOpen}
        onOpenChange={setMoreOpen}
        align="start"
        contentClassName="w-44 p-1"
        trigger={
          <Button
            variant="ghost"
            size="sm"
            aria-label={activeMoreLens === null ? "More views" : `More views (currently ${activeMoreLens.label})`}
            className={cn(activeMoreLens !== null && "bg-moss font-semibold text-ink hover:bg-moss")}
          >
            {activeMoreLens?.label ?? "More"}
          </Button>
        }
      >
        <div role="menu" aria-label="More views" className="flex flex-col gap-0.5">
          {MORE_LENSES.map((m) => (
            <Button
              key={m.value}
              variant="ghost"
              size="sm"
              role="menuitem"
              aria-current={lens === m.value ? "true" : undefined}
              onClick={() => {
                setLens(m.value);
                setMoreOpen(false);
              }}
              className={cn(
                "justify-start text-left",
                lens === m.value ? "bg-moss font-semibold text-ink hover:bg-moss" : "hover:bg-paper",
              )}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </Popover>
    </div>
  );
}
