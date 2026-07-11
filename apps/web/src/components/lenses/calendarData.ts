import type { TripDetail } from "@tc/contracts";

export type CalendarCell = {
  date: string;
  inTrip: boolean;
  ordinal?: number;
  activityIds: string[];
};

// Pure ISO-date math. NO wall-clock reads — dates are built only from explicit
// YYYY-MM-DD components via Date.UTC (deterministic), never `new Date()`.
function parseIso(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split("-").map(Number);
  return { y: y!, m: m!, d: d! };
}

function toUtcDate(iso: string): Date {
  const { y, m, d } = parseIso(iso);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

function addDays(dt: Date, n: number): Date {
  const next = new Date(dt.getTime());
  next.setUTCDate(next.getUTCDate() + n);
  return next;
}

// Monday-start week index: 0 = Monday ... 6 = Sunday.
function mondayStartWeekday(dt: Date): number {
  return (dt.getUTCDay() + 6) % 7;
}

function startOfMonth(dt: Date): Date {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
}

function endOfMonth(dt: Date): Date {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
}

// Pure — a padded month grid (Mon-start) covering the trip's derived date span.
// Trip days (matched by day.date) carry their 1-based ordinal and activityIds;
// padding days (outside the trip's days) are not in-trip and carry no activities.
export function calendarCells(detail: TripDetail): CalendarCell[] {
  if (detail.startDate === null) return [];

  const tripDays = detail.days.filter(
    (day): day is { dayId: string; activityIds: string[]; date: string; costSubtotal: number } =>
      day.date !== null,
  );
  if (tripDays.length === 0) return [];

  const sortedDates = tripDays.map((day) => day.date).sort();
  const firstDate = toUtcDate(sortedDates[0]!);
  const lastDate = toUtcDate(sortedDates[sortedDates.length - 1]!);

  const gridStart = addDays(startOfMonth(firstDate), -mondayStartWeekday(startOfMonth(firstDate)));
  const lastMonthEnd = endOfMonth(lastDate);
  const gridEnd = addDays(lastMonthEnd, (6 - mondayStartWeekday(lastMonthEnd) + 7) % 7);

  const byDate = new Map<string, { ordinal: number; activityIds: string[] }>();
  tripDays.forEach((day, index) => {
    byDate.set(day.date, { ordinal: index + 1, activityIds: day.activityIds });
  });

  const cells: CalendarCell[] = [];
  for (let cursor = gridStart; cursor.getTime() <= gridEnd.getTime(); cursor = addDays(cursor, 1)) {
    const iso = toIso(cursor);
    const match = byDate.get(iso);
    if (match) {
      cells.push({ date: iso, inTrip: true, ordinal: match.ordinal, activityIds: match.activityIds });
    } else {
      cells.push({ date: iso, inTrip: false, activityIds: [] });
    }
  }
  return cells;
}
