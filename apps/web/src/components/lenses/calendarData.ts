import type { TripDetail } from "@tc/contracts";

// A rendered calendar cell. `blank` cells are pure padding (a week's lead-in
// before a month's first real date, or trailing pad to a multiple of 7) and
// carry no date — SPEC.md §4's month blocks show only the weeks that matter,
// so padding never borrows a neighbouring month's day number.
export type CalendarCell =
  | { blank: true }
  | { blank: false; date: string; inTrip: false; activityIds: [] }
  | { blank: false; date: string; inTrip: true; ordinal: number; activityIds: string[] };

export type CalendarMonth = {
  label: string; // "November 2026" — font-display, 17px, 600 (SPEC.md §4)
  note: string; // "Day 8 – Day 14" / "Day 8" / "" — the ordinals this month's block holds
  cells: CalendarCell[];
};

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

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

// Sunday-start week index (SPEC.md §4 / the handoff design): 0 = Sunday ...
// 6 = Saturday. Matches Date#getUTCDay() directly — unlike the Monday-start
// grid this replaces, there is no offset to apply.
function sundayWeekday(dt: Date): number {
  return dt.getUTCDay();
}

function startOfMonth(dt: Date): Date {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), 1));
}

function endOfMonth(dt: Date): Date {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0));
}

function addMonths(dt: Date, n: number): Date {
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + n, 1));
}

// One stacked block per month the trip touches (SPEC.md §4), each trimmed to
// the weeks that matter rather than one grid spanning the trip's full range.
// Days are matched by full ISO date via a Map, never by day-of-month — SPEC.md
// §4 warns day-of-month matching scattered a Nov 27 → Dec 10 trip's December
// days onto November's 1st–10th; that was the design's own bug, and this never
// reproduces it.
export function calendarMonths(detail: TripDetail): CalendarMonth[] {
  if (detail.startDate === null) return [];

  const tripDays = detail.days.filter(
    (day): day is { dayId: string; activityIds: string[]; date: string; costSubtotal: number } =>
      day.date !== null,
  );
  if (tripDays.length === 0) return [];

  // Ordinal is the day's position in detail.days (array order) — the same
  // "Day N" numbering DayChips/chipModel already use — not sort order. Real
  // trips build days chronologically, so the two coincide; sorting is only
  // for the date span the grid needs.
  const sortedDates = tripDays.map((day) => day.date).sort();
  const firstDate = toUtcDate(sortedDates[0]!);
  const lastDate = toUtcDate(sortedDates[sortedDates.length - 1]!);

  // Rule 1: the grid's own start/end, walked out to whole weeks.
  const gridStart = addDays(firstDate, -sundayWeekday(firstDate));
  const gridEnd = addDays(lastDate, 6 - sundayWeekday(lastDate));

  const byDate = new Map<string, { ordinal: number; activityIds: string[] }>();
  tripDays.forEach((day, index) => {
    byDate.set(day.date, { ordinal: index + 1, activityIds: day.activityIds });
  });

  const months: CalendarMonth[] = [];
  const lastMonthStart = startOfMonth(lastDate);
  let monthCursor = startOfMonth(firstDate);

  while (monthCursor.getTime() <= lastMonthStart.getTime()) {
    const monthStart = monthCursor;
    const monthEnd = endOfMonth(monthCursor);
    // Rule 2: this month's window, clipped to the grid's span.
    const winStart = monthStart.getTime() < gridStart.getTime() ? gridStart : monthStart;
    const winEnd = monthEnd.getTime() > gridEnd.getTime() ? gridEnd : monthEnd;

    const cells: CalendarCell[] = [];
    for (let i = 0; i < sundayWeekday(winStart); i++) cells.push({ blank: true });

    for (let cursor = winStart; cursor.getTime() <= winEnd.getTime(); cursor = addDays(cursor, 1)) {
      const iso = toIso(cursor);
      const match = byDate.get(iso);
      cells.push(
        match
          ? { blank: false, date: iso, inTrip: true, ordinal: match.ordinal, activityIds: match.activityIds }
          : { blank: false, date: iso, inTrip: false, activityIds: [] },
      );
    }

    while (cells.length % 7 !== 0) cells.push({ blank: true });

    const inTripCells = cells.filter(
      (cell): cell is Extract<CalendarCell, { inTrip: true }> => !cell.blank && cell.inTrip,
    );
    // Rule 4: the ordinals this month's block holds.
    const note =
      inTripCells.length === 0
        ? ""
        : inTripCells.length === 1
          ? `Day ${inTripCells[0]!.ordinal}`
          : `Day ${inTripCells[0]!.ordinal} – Day ${inTripCells[inTripCells.length - 1]!.ordinal}`;

    months.push({
      label: `${MONTH_NAMES[monthCursor.getUTCMonth()]} ${monthCursor.getUTCFullYear()}`,
      note,
      cells,
    });

    monthCursor = addMonths(monthCursor, 1);
  }

  return months;
}
