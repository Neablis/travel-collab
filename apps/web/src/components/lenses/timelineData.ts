import type { TripDetail } from "@tc/contracts";

export type TimelineTimedItem = {
  activityId: string;
  title: string;
  start: string;
  end: string;
};

export type TimelineUntimedItem = {
  activityId: string;
  title: string;
};

export type TimelineRow = {
  dayId: string;
  date: string | null;
  ordinal: number;
  timed: TimelineTimedItem[];
  untimed: TimelineUntimedItem[];
};

export function timelineRows(detail: TripDetail): TimelineRow[] {
  return detail.days.map((day, index) => {
    const timed: TimelineTimedItem[] = [];
    const untimed: TimelineUntimedItem[] = [];

    for (const activityId of day.activityIds) {
      const activity = detail.activities[activityId];
      if (!activity) continue;
      if (activity.timeWindow) {
        timed.push({
          activityId: activity.activityId,
          title: activity.title,
          start: activity.timeWindow.start,
          end: activity.timeWindow.end,
        });
      } else {
        untimed.push({ activityId: activity.activityId, title: activity.title });
      }
    }

    timed.sort((a, b) => a.start.localeCompare(b.start));

    return {
      dayId: day.dayId,
      date: day.date,
      ordinal: index + 1,
      timed,
      untimed,
    };
  });
}
