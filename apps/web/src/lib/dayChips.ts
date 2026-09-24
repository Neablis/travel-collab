// The pure half of the day chips: one `ChipDay` per trip day, and the city a
// day is named for. Moved out of `components/trip/DayChips.tsx` on 2026-09-23
// because five folders (board, lenses, pages, assistant, home) imported these
// two functions from a React component file, which made `components/trip` a
// dependency of everything that names a day — and put it in import cycles
// with three of them. The component keeps the rendering; this keeps the data.
import type { TripDetail } from "@tc/contracts";
import { dayCity } from "@tc/pages";

export type ChipDay = {
  dow: string;
  dateNum: string;
  city: string | null;
  // The city this day arrived FROM — the previous day's derived city, set only
  // when it differs from this day's. Named "from" rather than "to" because
  // that is what it has always held the other half of: `transitionTo` was, by
  // construction, `city` itself (see chipModel), so the two could never carry
  // different information. Storing the from-half is what lets a chip render a
  // real "Tokyo → Nikkō" instead of "Nikkō → Nikkō".
  transitionFrom: string | null;
  transitionTo: string | null;
  stops: number;
};

// Dates are calendar dates (YYYY-MM-DD), not instants — construct in local
// time so "2027-06-01" never rolls back a day in a negative-offset zone.
// Mirrors lib/formatDate.ts's own local-parse helper; that module only
// exports pre-formatted strings (day-of-week + month + day together), not a
// bare Date, so this is a small local copy — exported so NextTripHero.tsx's
// sparkline day-number derivation reuses it rather than a third copy.
function parseLocalDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}

// The city a day is named for — the last located stop's city, else its area,
// else null. The rule and its reasons (last not first; no `name` fallback) live
// with the function in `@tc/pages`' `dayCity.ts` since 2026-09-24, so the
// notebook's "Trip strip" labels a run by the same answer this colours it by.
// Re-exported under this name so no web caller changed.
export const cityFor = dayCity;

// Pure: one ChipDay per TripDetail day, no DOM — testable standalone
// (mirrors Sparkline.tsx's sparklineBars). transitionTo is set only when
// this day's derived city differs from the *previous* day's derived city
// and both are non-null, so a day with no located activity (or the very
// first day, which has no previous day at all) never claims a fake
// transition.
/** One `ChipDay` per trip day — weekday, date number, derived city, stop count and any city transition — for the day chips and every other surface that labels a day. */
export function chipModel(detail: TripDetail): ChipDay[] {
  let previousCity: string | null = null;

  return detail.days.map((day, index) => {
    const city = cityFor(day, detail.activities);
    const moved = previousCity !== null && city !== null && city !== previousCity;
    const transitionFrom = moved ? previousCity : null;
    const transitionTo = moved ? city : null;
    previousCity = city;

    const dow =
      day.date === null
        ? `Day ${index + 1}`
        : parseLocalDate(day.date).toLocaleDateString("en-US", { weekday: "short" });
    const dateNum = day.date === null ? "" : String(parseLocalDate(day.date).getDate());

    return { dow, dateNum, city, transitionFrom, transitionTo, stops: day.activityIds.length };
  });
}
