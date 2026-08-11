"use client";

import type { TripDetail } from "@tc/contracts";
import { useLens } from "../trip/context/LensRouter";
import { TimelineLens } from "./TimelineLens";
import { CalendarLens } from "./CalendarLens";

// The Timeline/Calendar switch used to live here as its own SegmentedControl
// (a sub-view nested inside this one "Schedule" lens). TripViewTabs.tsx now
// exposes Timeline and Calendar as top-level peer tabs (matching the design
// handoff's 3-tab strip), driving the same `view` state from LensRouter —
// so this component just renders whichever view is current, with no nav
// control of its own left to render.
export function ScheduleLens({
  detail,
  onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const { view } = useLens();

  return (
    <div data-testid="schedule-lens">
      {view === "Timeline" ? (
        <TimelineLens detail={detail} onSelectActivity={onSelectActivity} />
      ) : (
        <CalendarLens detail={detail} onSelectActivity={onSelectActivity} />
      )}
    </div>
  );
}
