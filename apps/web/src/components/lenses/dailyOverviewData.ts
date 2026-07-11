import type { TripDetail } from "@tc/contracts";

export type DailyRow = { dayId: string; date: string | null; ordinal: number; activityCount: number; costSubtotal: number; conflictCount: number };

export function dailyRows(detail: TripDetail): DailyRow[] {
  return detail.days.map((d, i) => {
    const ids = new Set(d.activityIds);
    const conflictCount = detail.conflicts.filter((c) => c.subjects.some((s) => ids.has(s))).length;
    return { dayId: d.dayId, date: d.date, ordinal: i + 1, activityCount: d.activityIds.length, costSubtotal: d.costSubtotal, conflictCount };
  });
}
