import tzLookup from "@photostructure/tz-lookup";
import { AIRPORT_CODES_BY_ZONE } from "./airportTimeZones.generated";

// Coordinates and airport codes → IANA time zone, for `TripGlobals` (M14 link
// 11). **Server-only, and that is the decision rather than where it happened to
// land**: M14's "Decided 2026-09-24" defaults compute zones here and ship the
// browser a string, so no boundary dataset reaches a client bundle. The
// widgets do their arithmetic on that string with `Intl`, which every browser
// already carries.
//
// Two datasets, each named where it is loaded and in the contracts CHANGELOG:
//
// - `@photostructure/tz-lookup` (CC0-1.0; its data is derived from
//   timezone-boundary-builder, ODbL-1.0) for a stop's coordinates. ~73 kB,
//   ~29 kB gzipped, in memory, no I/O. It is lossy near borders — a day's zone
//   comes from a stop in a city, where it is right, not from a point in the
//   sea. geo-tz would be exact and is ~70 MB, which a serverless function pays
//   on every cold start.
// - `airportTimeZones.generated.ts` for the account's home airport, computed
//   offline with geo-tz from OurAirports (public domain). Its generator says
//   why the accurate lookup is affordable there and not here.
//
// Neither reads a clock, a file or the network, so both are pure functions of
// their arguments and `buildTripGlobals` stays one.

/**
 * The IANA zone at a point, or `null` for coordinates that are not a point.
 *
 * `null` rather than a throw: the contract already bounds `lat`/`lng`, so the
 * only way here with a bad pair is stored data no parse ran over, and one bad
 * stop must cost that day its zone rather than the whole projection its 500.
 */
export function timeZoneAt(lat: number, lng: number): string | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  for (const box of DATE_LINE_CORRECTIONS) {
    if (lat >= box.south && lat <= box.north && lng >= box.west && lng <= box.east) return box.zone;
  }
  return tzLookup(lat, lng);
}

/**
 * Boxes where the coarse grid draws a border on the wrong side of an inhabited
 * island, and the zone that is right inside them (KI-2026-10-24-h).
 *
 * Only borders that cross the date line are here, because only there is a few
 * tenths of a degree a whole calendar day. The grid puts the Samoa / American
 * Samoa border at about 170.63°W, through Pago Pago, and the Tokelau / American
 * Samoa one at about 9.35°S, through Fakaofo. Each box spans just the open sea
 * between the two territories' nearest islands, so its edges need not be exact:
 * Upolu ends at 171.39°W, Tutuila starts at 170.85°W, Fakaofo is at 9.38°S and
 * Swains Island at 11.06°S. `timeZones.test.ts` pins a town on each side.
 */
const DATE_LINE_CORRECTIONS: readonly { south: number; north: number; west: number; east: number; zone: string }[] = [
  // Tutuila and Aunu'u, up to the open sea east of Upolu.
  { south: -15, north: -13, west: -171.1, east: -170.6, zone: "Pacific/Pago_Pago" },
  // Fakaofo, up to the open sea north of Swains Island.
  { south: -10.2, north: -9.3, west: -171.6, east: -170.8, zone: "Pacific/Fakaofo" },
];

let zoneByAirport: Map<string, string> | undefined;

/**
 * The IANA zone of an IATA airport, or `null` when the code is not in the table.
 *
 * The account field is regex-validated and never looked up (`identity.ts`), so
 * a well-formed code that names no airport is ordinary input — it reports
 * "no home zone", the same as an unset field.
 */
export function timeZoneOfAirport(code: string | null): string | null {
  if (code === null) return null;
  if (zoneByAirport === undefined) {
    zoneByAirport = new Map();
    for (const [zone, codes] of Object.entries(AIRPORT_CODES_BY_ZONE)) {
      for (let i = 0; i < codes.length; i += 3) zoneByAirport.set(codes.slice(i, i + 3), zone);
    }
  }
  return zoneByAirport.get(code) ?? null;
}
