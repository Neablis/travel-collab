import type { TripDetail } from "@tc/contracts";

// The city a day is named for: the LAST scheduled activity's `location.city`
// (the geocoder's own structured city/town/village, distinct from the full
// place-name label), falling back to `area`.
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
// `city` stays FIRST here, unlike shortPlace() (apps/web lib/place.ts), which
// leads with `area`. This value names the day and drives the day accent and the
// "Tokyo → Nikkō" transition, so a ward or neighbourhood in this slot would
// split one city's days apart and invent transitions inside a single city.
//
// `area` is the ONLY fallback, and there is deliberately no `name` one.
// Resolved when #72 (KI-35) merged: #72 was written off a `main` that predated
// Mitchell's instruction on the #71 preview — "Never fall back to name, if you
// have absolutely no city, then make a new bucket with no city in title" — and
// so restored `?? location.name`. That rule stands: a venue name is not a
// place, and it is how a restaurant came to label a whole day. `area` does not
// violate it, because a real locality ("Higashiyama") IS a place; the venue
// name ("Kiyomizu-dera") never was. So a day whose stops carry neither city
// nor area has no city, and says so by returning null.
//
// **Why it lives in `@tc/pages`** (moved from `apps/web/src/lib/dayChips.ts`
// 2026-09-24, M14 link 11), for `needsBooking`'s reason: the "Trip strip"
// widget labels its runs by a day's city while `apps/web` colours the same
// cells through `cityAccents` → this function. Two copies of "a day's city"
// would let a run read "Kyoto" in Osaka's colour; one copy cannot.
// `apps/web`'s `cityFor` is this, re-exported under the name its callers use.
//
// A transit stop's DESTINATION comes first (M24; Mitchell, 2026-09-25). This
// names the day by where it ends, and a leg ends at its `endLocation`, so a
// day closed by "Shinkansen Odawara → Kyoto" is a Kyoto day. Walking back, the
// destination is checked before the stop's own `location` (its origin), under
// the same rules: city then area, non-empty, no `name`. A destination naming
// neither falls through to the origin. Deliberately unlike `citiesOfStops`,
// which lists both, and `shortPlace`, which keeps the origin: each answers a
// different question.
/** The city (or, failing that, the area) of a day's last located activity — a leg's destination before its origin — or `null` when none of its stops names either. */
export function dayCity(day: TripDetail["days"][number], activities: TripDetail["activities"]): string | null {
  for (let index = day.activityIds.length - 1; index >= 0; index--) {
    const activity = activities[day.activityIds[index]!];
    for (const location of [activity?.endLocation, activity?.location]) {
      const place = location?.city ?? location?.area;
      if (place !== undefined && place !== "") return place;
    }
  }
  return null;
}
