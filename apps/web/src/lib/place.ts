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

// The full label a geocoder hands back is an address, not a place name:
// "National Museum of Play at The Strong, Rochester, Monroe County, New York,
// 14607, USA". Rendered whole it wraps to three lines on a card and buries the
// one part a reader is looking for. Mitchell, 2026-08-30 design pass: "We are
// using too much of the address when showing it in ui, we dont need all these
// sub parts, just name, city, and country if possible."
//
// So: venue, city, country — "National Museum of Play at The Strong,
// Rochester, United States". Distinct from `shortPlace()` above, which is the
// *one-token* whereabouts label a timeline route line needs; this is the
// full identification of a place, just without the county, state and postcode.
//
// - venue comes from `name`'s first comma segment, which is the geocoder's own
//   most-specific component.
// - city comes from the structured `city` field, and is dropped when it merely
//   repeats the venue (a geocoded city itself has both).
// - country comes from `countryCode` through `Intl.DisplayNames`, so it reads
//   "Japan" rather than "JP". The last segment of `name` is usually the
//   country too, but not reliably (it is sometimes "USA", sometimes absent),
//   and it is not a code we can localize.
//
// Returns `null` only for no location at all, matching `shortPlace()`.
export function displayPlace(location: Location | null | undefined): string | null {
  if (!location) return null;
  const venue = location.name.split(",")[0]?.trim();
  const parts: string[] = [];
  if (venue) parts.push(venue);
  if (location.city && location.city !== venue) parts.push(location.city);
  const country = countryName(location.countryCode);
  if (country !== null && country !== venue && country !== location.city) parts.push(country);
  // A location whose `name` is somehow empty still has to render as something;
  // the untrimmed name is a better fallback than an empty string.
  return parts.length > 0 ? parts.join(", ") : location.name;
}

// `Intl.DisplayNames` throws on a code it cannot map rather than returning
// undefined, and is absent in some runtimes, so a failure falls back to the
// raw code — "JP" is a worse label than "Japan" but a better one than nothing.
function countryName(code: string | undefined): string | null {
  if (code === undefined) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
