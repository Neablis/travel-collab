import type { Location } from "@tc/contracts";

// A short, honest label for a Location — for the timeline's route line and
// activity place line, which used to render the full geocoded `name` (e.g.
// "Ugly Duck Coffee, Rochester, NY, USA → The Strong National Museum of Play,
// Rochester, Monroe County, New York, USA") and wrapped badly.
//
// Prefers `location.city` (packages/contracts src/activity.ts — the
// geocoder's own structured city/town/village, distinct from `name`). Falls
// back to the first comma-delimited segment of `name` (the venue itself, for
// a manually-entered location or one that predates `city`/has no city-level
// address component). `null` only for no location at all — the same "closest
// honest proxy, not a fabricated field" stance DayChips.tsx's cityFor already
// documents for the day-chip city, just applied per place instead of per day.
export function shortPlace(location: Location | null | undefined): string | null {
  if (!location) return null;
  if (location.city) return location.city;
  const [first] = location.name.split(",");
  return first?.trim() ?? null;
}
