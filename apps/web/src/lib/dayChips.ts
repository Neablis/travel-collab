// The pure half of the day chips: one `ChipDay` per trip day, and the city a
// day is named for. Moved out of `components/trip/DayChips.tsx` on 2026-09-23
// because five folders (board, lenses, pages, assistant, home) imported these
// two functions from a React component file, which made `components/trip` a
// dependency of everything that names a day — and put it in import cycles
// with three of them. The component keeps the rendering; this keeps the data.
import type { TripDetail } from "@tc/contracts";

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

// The LAST scheduled activity's location.city (packages/contracts'
// Location.city — the geocoder's own structured city/town/village, distinct
// from the full place-name label).
//
// Last, not first (Mitchell, 2026-08-29): the day label compares yesterday's
// last activity city with today's, because where you END a day is where you
// start the next one — SPEC §12's own framing is that the day belongs to
// where you end up. On the Japan fixture first and last coincide (whole days
// sit in one city) so nothing rendered differently when this flipped; the
// case it fixes is a day that genuinely spans two cities, which is the only
// case the "Tokyo → Kyoto" transition line exists for. Reading the first stop
// there named the travel day by the city it was leaving and pushed the arrow
// onto the FOLLOWING day, which never moved.
//
// `city` stays FIRST here, unlike shortPlace() (lib/place.ts), which leads
// with `area`. This value names the day and drives the day accent and the
// "Tokyo → Nikkō" transition, so a ward or neighbourhood in this slot would
// split one city's days apart and invent transitions inside a single city.
//
// `area` is the ONLY fallback, and there is deliberately no `name` one.
// Resolved here when #72 (KI-35) merged into this branch: #72 was written off
// a `main` that predated Mitchell's instruction on the #71 preview — "Never
// fall back to name, if you have absolutely no city, then make a new bucket
// with no city in title" — and so restored `?? location.name`. That rule
// stands: a venue name is not a place, and it is how a restaurant came to
// label a whole day. `area` does not violate it, because a real locality
// ("Higashiyama") IS a place; the venue name ("Kiyomizu-dera") never was.
// So a day whose stops carry neither city nor area has no city, and says so
// by returning null — the callers all handle that.
//
// Walks back through earlier activityIds if the last has no location; null if
// none of the day's activities name a city or an area.
/** The city (or, failing that, the area) of a day's last located activity, or `null` when none of its stops names either. */
export function cityFor(day: TripDetail["days"][number], activities: TripDetail["activities"]): string | null {
  for (let index = day.activityIds.length - 1; index >= 0; index--) {
    const activityId = day.activityIds[index]!;
    const location = activities[activityId]?.location;
    const place = location?.city ?? location?.area;
    if (place !== undefined && place !== "") return place;
  }
  return null;
}

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
