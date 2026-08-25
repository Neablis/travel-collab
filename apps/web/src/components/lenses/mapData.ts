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

// Scoped to day-attached activities only (Mitchell, preview review,
// 2026-08-25: "dont plot locations that arent attached to a day, anything
// unscheduled isnt on the map"). A backlog activity with no location isn't
// something the map is skipping because of its missing place — the map
// never draws backlog stops at all, located or not — so nagging about it
// here would flag a gap this lens deliberately doesn't care about.
export function unlocatedActivities(detail: TripDetail): ActivityView[] {
  const dayActivityIds = new Set(detail.days.flatMap((d) => d.activityIds));
  const values = Object.values(detail.activities) as ActivityView[];
  return values.filter((a) => dayActivityIds.has(a.activityId) && a.location?.lat === undefined);
}
