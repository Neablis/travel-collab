import type { TripDetail } from "@tc/contracts";

export type ItineraryActivity = { activityId: string; title: string; start: string | null; end: string | null; place: string | null; costMinor: number | null };
export type ItineraryDay = { dayId: string; date: string | null; ordinal: number; activities: ItineraryActivity[]; costSubtotal: number };

function toActivity(detail: TripDetail, id: string): ItineraryActivity {
  const a = detail.activities[id]!;
  return { activityId: id, title: a.title, start: a.timeWindow?.start ?? null, end: a.timeWindow?.end ?? null, place: a.location?.name ?? null, costMinor: a.cost?.amountMinor ?? null };
}

export function itineraryDays(detail: TripDetail): ItineraryDay[] {
  return detail.days.map((d, i) => ({ dayId: d.dayId, date: d.date, ordinal: i + 1, activities: d.activityIds.map((id) => toActivity(detail, id)), costSubtotal: d.costSubtotal }));
}

export function itineraryUnscheduled(detail: TripDetail): ItineraryActivity[] {
  return detail.backlog.map((id) => toActivity(detail, id));
}
