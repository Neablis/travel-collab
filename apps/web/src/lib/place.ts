import type { Location } from "@tc/contracts";

// A short, honest label for a Location — for the timeline's route line and
// activity place line, which used to render the full geocoded `name` (e.g.
// "Ugly Duck Coffee, Rochester, NY, USA → The Strong National Museum of Play,
// Rochester, Monroe County, New York, USA") and wrapped badly.
//
// Most-specific-first: `area`, then `city`, then the first comma-delimited
// segment of `name`.
//
// `area` leads because this line answers "where in the trip is this stop",
// and a day spent inside one city is exactly where the city stops answering
// it: four Tokyo stops rendered "Tokyo → Tokyo → Tokyo → Tokyo" and told the
// reader nothing, where "Ōta → Shibuya → Nishi-Azabu → Ebisu" is the actual
// shape of the day. Note this is the OPPOSITE order to cityFor()
// (DayChips.tsx), which is city-first on purpose — that one names the day's
// city and must keep doing so. The two disagree because they answer different
// questions, not by accident.
//
// The `name` segment stays last and is still only a stand-in: it is the venue
// itself ("Ugly Duck Coffee"), not a locality, so it reads oddly in a slot
// that means "whereabouts". It is reached only by a location with neither
// structured field — manually entered, or written before either existed. That
// mismatch is what KI-35 was; `area` is the field that now fills the slot
// honestly, and this is the last resort rather than the first.
//
// `null` only for no location at all.
export function shortPlace(location: Location | null | undefined): string | null {
  if (!location) return null;
  if (location.area) return location.area;
  if (location.city) return location.city;
  const [first] = location.name.split(",");
  return first?.trim() ?? null;
}
