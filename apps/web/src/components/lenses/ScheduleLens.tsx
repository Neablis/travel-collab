"use client";

import type { TripDetail } from "@tc/contracts";
import { SegmentedControl } from "../ui/segmented-control";
import { SCHEDULE_VIEWS, useLens } from "../trip/context/LensRouter";
import { TimelineLens } from "./TimelineLens";
import { CalendarLens } from "./CalendarLens";

export function ScheduleLens({
  detail,
  onSelectActivity,
}: {
  detail: TripDetail;
  onSelectActivity?: (activityId: string) => void;
}) {
  const { view, setView } = useLens();

  return (
    <div data-testid="schedule-lens" className="flex flex-col gap-3">
      <div className="flex justify-end">
        <SegmentedControl
          variant="subtle"
          value={view}
          onValueChange={setView}
          options={SCHEDULE_VIEWS.map((v) => ({ value: v, label: v }))}
          aria-label="Schedule view"
        />
      </div>
      {view === "Timeline" ? (
        <TimelineLens detail={detail} onSelectActivity={onSelectActivity} />
      ) : (
        <CalendarLens detail={detail} onSelectActivity={onSelectActivity} />
      )}
    </div>
  );
}
