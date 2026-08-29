"use client";

import type { TripCommand, TripDetail } from "@tc/contracts";
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
  onCommand,
  readOnly = false,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
  // Passed straight through to TimelineLens (the overlap warning's fix and
  // dismiss) — this component owns no commands of its own.
  onCommand?: (command: TripCommand) => void;
  /** Forwarded to the timeline: show the plan, offer nothing that changes it. */
  readOnly?: boolean;
}) {
  const { view } = useLens();

  return (
    <div data-testid="schedule-lens">
      {view === "Timeline" ? (
        <TimelineLens detail={detail} onSelectActivity={onSelectActivity} onCommand={onCommand} readOnly={readOnly} />
      ) : (
        <CalendarLens detail={detail} onSelectActivity={onSelectActivity} />
      )}
    </div>
  );
}
