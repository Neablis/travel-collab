import type { TripDetail } from "@tc/contracts";
// One ISO parse for apps/web, not two — see the KI-73 note above `toIso` below.
import { addDaysIso, parseIsoDateUtc } from "@/lib/dates";

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

// Pure ISO-date math. NO wall-clock reads — every Date here is built from an
// explicit YYYY-MM-DD, in UTC, never from a bare `new Date()`.
//
// KI-73: this file used to carry its OWN parse, `new Date(Date.UTC(y, m - 1,
// d))`, alongside the `lib/dates.ts` one it already imported `addDaysIso`
// from. The comment here claimed the two "agree for every date the domain can
// emit", which was true only because `deriveDayDates` normalised everything
// through the same `Date.UTC` first — the two mechanisms themselves disagree
// on input `TripDate` accepts ("2026-02-30" rolled over to March 2 here and
// threw there; "0026-01-01" became 1926-01-01 here and stayed put there).
// There is now one parse for apps/web, imported at the top of this file.

function toIso(dt: Date): string {
  return dt.toISOString().slice(0, 10);
}

// Month arithmetic on an ALREADY-VALIDATED Date, so it takes components
// rather than a string and deliberately relies on `Date.UTC`'s rollover
// (month 12 -> next January, day 0 -> the previous month's last day).
//
// The `setUTCFullYear` fix-up is the other half of KI-73's two-digit-year
// trap: `Date.UTC(26, 0, 1)` means 1926, so once `parseIsoDateUtc` started
// (correctly) admitting year 26, feeding `getUTCFullYear()` back into
// `Date.UTC` would have thrown the century away again — and this file would
// have disagreed with ITSELF, cell dates in year 26 and month headers in
// 1926. Re-setting the year afterwards keeps the intended rollover in month
// and day while restoring the real year.
function utcFromParts(year: number, monthIndex: number, day: number): Date {
  const dt = new Date(Date.UTC(year, monthIndex, day));
  if (year >= 0 && year <= 99) dt.setUTCFullYear(year);
  return dt;
}

// Sunday-start week index (SPEC.md §4 / the handoff design): 0 = Sunday ...
// 6 = Saturday. Matches Date#getUTCDay() directly — unlike the Monday-start
// grid this replaces, there is no offset to apply.
function sundayWeekday(dt: Date): number {
  return dt.getUTCDay();
}

function startOfMonth(dt: Date): Date {
  return utcFromParts(dt.getUTCFullYear(), dt.getUTCMonth(), 1);
}

function endOfMonth(dt: Date): Date {
  return utcFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0);
}

function addMonths(dt: Date, n: number): Date {
  return utcFromParts(dt.getUTCFullYear(), dt.getUTCMonth() + n, 1);
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
  const firstDate = parseIsoDateUtc(sortedDates[0]!);
  const lastDate = parseIsoDateUtc(sortedDates[sortedDates.length - 1]!);

  // Rule 1: the grid's own start/end, walked out to whole weeks.
  const gridStart = parseIsoDateUtc(addDaysIso(sortedDates[0]!, -sundayWeekday(firstDate)));
  const gridEnd = parseIsoDateUtc(addDaysIso(sortedDates[sortedDates.length - 1]!, 6 - sundayWeekday(lastDate)));

  const byDate = new Map<string, { ordinal: number; activityIds: string[] }>();
  detail.days.forEach((day, index) => {
    if (day.date !== null) {
      byDate.set(day.date, { ordinal: index + 1, activityIds: day.activityIds });
    }
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

    // Walked as ISO strings, which compare chronologically for YYYY-MM-DD, so
    // the one add-days implementation covers the cursor too.
    const winEndIso = toIso(winEnd);
    for (let iso = toIso(winStart); iso <= winEndIso; iso = addDaysIso(iso, 1)) {
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
