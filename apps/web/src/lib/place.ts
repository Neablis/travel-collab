import type { ActivityView, Location } from "@tc/contracts";

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
//
// M24 (Mitchell, 2026-09-25): this stays ONE place. A transit stop's two
// places are `location` (origin) and `endLocation` (destination), and every
// caller passes `location`, so a leg is labelled by where it leaves from. A
// surface that wants the leg as a leg renders `shortPlace` on each end
// ("Odawara → Kyoto"), and `legRoute` below is that rendering. It should not
// teach this function about `endLocation`, because its one-token slot has room
// for one place. It takes a `Location` rather than an activity, so it cannot
// read the destination by accident.
export function shortPlace(location: Location | null | undefined): string | null {
  if (!location) return null;
  if (location.area) return location.area;
  if (location.city) return location.city;
  const [first] = location.name.split(",");
  return first?.trim() ?? null;
}

// A stop's destination, read through the one check every surface needs: only
// a `kind: "transit"` stop has one. The contract's refinement guards commands,
// not stored rows (`travelLegFieldsOffTransit`), so a stored non-transit stop
// may still carry an `endLocation`, and a surface that trusted it would draw a
// route the map (`mapRailData.ts`) refuses to. KI-2026-09-25-q asks for this
// same function in `@tc/contracts`, taking "start" | "end", so `@tc/pages`
// can share it; until then the web app's surfaces go through this one.
/** A transit stop's `endLocation`, or `null` for any other kind and for a leg with no destination. */
export function legEnd(stop: Pick<ActivityView, "kind" | "endLocation">): Location | null {
  return stop.kind === "transit" ? (stop.endLocation ?? null) : null;
}

// Mitchell, 2026-09-30 (option "B"): a leg's destination shows everywhere the
// stop does, not only as the map's line. This is that label, short enough for
// a 100px river lane: "Taipei → Tainan".
//
// **City first, the opposite of `shortPlace`.** A leg answers "from where to
// where", and between two cities the cities are the answer; two stations'
// wards ("Shimogyō → Kita") name the platforms and lose the trip. An end with
// no city takes `shortPlace`'s chain from there (area, then the name's first
// segment).
//
// **One city at both ends falls back to `shortPlace`**, the case `shortPlace`
// leads with `area` for ("Tokyo → Tokyo" says nothing; "Asakusa → Shibuya" is
// the leg), and to the venue names when even those agree.
//
// No origin reads "→ Kyoto": the destination is the half this label exists to
// add, so it is kept even when the stop never said where it leaves from.
/** "Origin → Destination" for a transit stop that has a destination, or `null` when it is not a leg. */
export function legRoute(stop: Pick<ActivityView, "kind" | "location" | "endLocation">): string | null {
  const end = legEnd(stop);
  if (end === null) return null;
  const start = stop.location;
  if (start === null) return `→ ${townOf(end)}`;
  const [fromTown, toTown] = [townOf(start), townOf(end)];
  if (fromTown !== toTown) return `${fromTown} → ${toTown}`;
  const [fromArea, toArea] = [shortPlace(start), shortPlace(end)];
  if (fromArea !== toArea) return `${fromArea} → ${toArea}`;
  return `${venueOf(start)} → ${venueOf(end)}`;
}

function townOf(location: Location): string {
  return location.city ?? shortPlace(location) ?? location.name;
}

function venueOf(location: Location): string {
  return location.name.split(",")[0]?.trim() || location.name;
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
//
// Exported for `server/places.ts` (M12 link 7), which names the countries the
// place search returns: the database stores codes only, so the name a
// searcher types against must be this same derivation, not a second table.
/** The English name for an ISO alpha-2 code ("JP" → "Japan"), the code itself when unmappable, null for none. */
export function countryName(code: string | undefined): string | null {
  if (code === undefined) return null;
  try {
    return new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}
