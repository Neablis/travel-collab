import type { ActivityView, TripDetail } from "@tc/contracts";

export type ActivityPin = { activityId: string; title: string; lat: number; lng: number; dayId: string | null };

export function activityPins(detail: TripDetail): ActivityPin[] {
  const dayOf = new Map<string, string>();
  for (const day of detail.days) for (const id of day.activityIds) dayOf.set(id, day.dayId);
  const pins: ActivityPin[] = [];
  const entries = Object.entries(detail.activities) as [string, ActivityView][];
  for (const [id, a] of entries) {
    if (a.location?.lat !== undefined && a.location.lng !== undefined) {
      pins.push({ activityId: id, title: a.title, lat: a.location.lat, lng: a.location.lng, dayId: dayOf.get(id) ?? null });
    }
  }
  return pins;
}

export function unlocatedActivities(detail: TripDetail): ActivityView[] {
  const values = Object.values(detail.activities) as ActivityView[];
  return values.filter((a) => a.location?.lat === undefined);
}
